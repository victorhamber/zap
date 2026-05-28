import { prisma } from "../prisma.js";
import { normalizePhone } from "../utils/phone.js";

function toStoragePhone(phone: string): string {
  if (phone.includes("@g.us")) return phone.trim();
  return normalizePhone(phone.replace(/[^\d+]/g, ""));
}

export async function getContactTagNames(phone: string): Promise<string[]> {
  if (!prisma) return [];
  const normalized = toStoragePhone(phone);
  const contact = await prisma.contact.findUnique({
    where: { phone: normalized },
    include: { tags: { include: { tag: true } } }
  });
  return contact?.tags.map((t) => t.tag.name) ?? [];
}

export async function upsertContact(
  phone: string,
  data: { name?: string; notes?: string; tagIds?: string[] }
) {
  if (!prisma) throw new Error("Banco indisponível");
  const normalized = toStoragePhone(phone);

  const contact = await prisma.contact.upsert({
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
    await prisma.contactTag.deleteMany({ where: { contactId: contact.id } });
    if (data.tagIds.length > 0) {
      await prisma.contactTag.createMany({
        data: data.tagIds.map((tagId) => ({ contactId: contact.id, tagId })),
        skipDuplicates: true
      });
    }
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
