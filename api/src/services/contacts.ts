import { prisma } from "../prisma.js";
import { expandPhoneLookupKeys, firstNameFromFullName, canonicalBrazilPhone } from "../utils/phone.js";
import { dispatchTagTriggerFlows } from "./tagFlowTrigger.js";

function toStoragePhone(phone: string): string {
  if (phone.includes("@g.us")) return phone.trim();
  return canonicalBrazilPhone(phone);
}

type ContactWithTags = Awaited<ReturnType<typeof listContactsWithTags>>[number];

async function findContactByPhoneLoose(phone: string): Promise<ContactWithTags | null> {
  if (!prisma) return null;

  const keys = expandPhoneLookupKeys(toStoragePhone(phone));
  if (keys.length === 0) return null;

  const matches = await prisma.contact.findMany({
    where: { phone: { in: keys } },
    include: { tags: { include: { tag: true } } },
    orderBy: { updatedAt: "desc" }
  });

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  // Mesmo contato salvo com/sem nono dígito — usa o registro mais completo.
  return matches.sort((a, b) => {
    const score = (c: typeof a) =>
      (c.tags.length > 0 ? 10 : 0) + (c.name?.trim() ? 5 : 0) + c.phone.length;
    return score(b) - score(a);
  })[0];
}

export async function getContactTagNames(phone: string): Promise<string[]> {
  if (!prisma) return [];
  const contact = await findContactByPhoneLoose(phone);
  return contact?.tags.map((t) => t.tag.name) ?? [];
}

export async function upsertContact(
  phone: string,
  data: { name?: string; notes?: string; tagIds?: string[] }
) {
  if (!prisma) throw new Error("Banco indisponível");
  const normalized = toStoragePhone(phone);
  const existing = await findContactByPhoneLoose(normalized);

  const contact = existing
    ? await prisma.contact.update({
        where: { id: existing.id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {})
        }
      })
    : await prisma.contact.upsert({
        where: { phone: normalized },
        update: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {})
        },
        create: {
          phone: normalized,
          name: data.name
        }
      });

  if (data.tagIds) {
    const before = await prisma.contact.findUnique({
      where: { id: contact.id },
      include: { tags: { include: { tag: true } } }
    });
    const beforeIds = new Set(before?.tags.map((t) => t.tagId) ?? []);

    await prisma.contactTag.deleteMany({ where: { contactId: contact.id } });
    if (data.tagIds.length > 0) {
      await prisma.contactTag.createMany({
        data: data.tagIds.map((tagId) => ({ contactId: contact.id, tagId })),
        skipDuplicates: true
      });
    }

    const addedIds = data.tagIds.filter((id) => !beforeIds.has(id));
    if (addedIds.length > 0) {
      const addedTags = await prisma.tag.findMany({ where: { id: { in: addedIds } } });
      if (addedTags.length > 0) {
        await dispatchTagTriggerFlows({
          phone: contact.phone,
          addedTagNames: addedTags.map((t) => t.name),
          contactName: contact.name ?? undefined
        }).catch(() => {});
      }
    }

    const { retryAiPipelineForContact } = await import("./ai/enqueue.js");
    await retryAiPipelineForContact(contact.phone).catch(() => {});
  }

  return prisma.contact.findUnique({
    where: { id: contact.id },
    include: { tags: { include: { tag: true } } }
  });
}

export async function listContactsWithTags() {
  if (!prisma) return [];
  return prisma.contact.findMany({
    include: { tags: { include: { tag: true } } },
    orderBy: { updatedAt: "desc" }
  });
}

export function contactToJson(
  c: Awaited<ReturnType<typeof listContactsWithTags>>[number]
) {
  return {
    id: c.id,
    phone: c.phone,
    name: c.name,
    notes: c.notes,
    tags: c.tags.map((ct) => ({
      id: ct.tag.id,
      name: ct.tag.name,
      color: ct.tag.color
    }))
  };
}

export async function ensureContact(phone: string, name?: string) {
  if (!prisma) throw new Error("Banco indisponível");
  const normalized = toStoragePhone(phone);
  const existing = await findContactByPhoneLoose(normalized);

  if (existing) {
    if (name !== undefined && name.trim()) {
      return prisma.contact.update({
        where: { id: existing.id },
        data: { name: firstNameFromFullName(name, name.trim()) }
      });
    }
    return existing;
  }

  return prisma.contact.upsert({
    where: { phone: normalized },
    update: name !== undefined && name.trim() ? { name: firstNameFromFullName(name, name.trim()) } : {},
    create: {
      phone: normalized,
      name: name?.trim() ? firstNameFromFullName(name, name.trim()) : undefined
    }
  });
}

export async function ensureTagsByNames(names: string[]) {
  if (!prisma) throw new Error("Banco indisponível");
  const tags = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const tag = await prisma.tag.upsert({
      where: { name },
      create: { name },
      update: {}
    });
    tags.push(tag);
  }
  return tags;
}

export async function addContactTagsByNames(phone: string, tagNames: string[], contactName?: string) {
  const contact = await ensureContact(phone, contactName);
  const tags = await ensureTagsByNames(tagNames);
  if (tags.length === 0) return contact;

  const existing = await prisma!.contactTag.findMany({
    where: { contactId: contact.id, tagId: { in: tags.map((t) => t.id) } }
  });
  const existingIds = new Set(existing.map((row) => row.tagId));
  const newTags = tags.filter((tag) => !existingIds.has(tag.id));
  if (newTags.length === 0) {
    return prisma!.contact.findUnique({
      where: { id: contact.id },
      include: { tags: { include: { tag: true } } }
    });
  }

  await prisma!.contactTag.createMany({
    data: newTags.map((tag) => ({ contactId: contact.id, tagId: tag.id })),
    skipDuplicates: true
  });

  await dispatchTagTriggerFlows({
    phone: contact.phone,
    addedTagNames: newTags.map((t) => t.name),
    contactName: contact.name ?? contactName
  }).catch(() => {});

  return prisma!.contact.findUnique({
    where: { id: contact.id },
    include: { tags: { include: { tag: true } } }
  });
}

export async function removeContactTagsByNames(phone: string, tagNames: string[]) {
  if (!prisma) return;
  const contact = await findContactByPhoneLoose(phone);
  if (!contact) return;
  const names = tagNames.map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) return;
  const tags = await prisma.tag.findMany({ where: { name: { in: names } } });
  if (tags.length === 0) return;
  await prisma.contactTag.deleteMany({
    where: { contactId: contact.id, tagId: { in: tags.map((t) => t.id) } }
  });
}

export { findContactByPhoneLoose };
