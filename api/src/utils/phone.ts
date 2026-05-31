export function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  const digits = trimmed.replace(/[^\d]/g, "");
  return plus + digits;
}

export function phoneDigits(phone: string): string {
  return normalizePhone(phone).replace(/\D/g, "");
}

/** DDI por ISO 3166-1 alpha-2 (mercados comuns Hotmart). */
const COUNTRY_DIAL_CODES: Record<string, string> = {
  AR: "54",
  BO: "591",
  BR: "55",
  CL: "56",
  CO: "57",
  CR: "506",
  DO: "1",
  EC: "593",
  ES: "34",
  FR: "33",
  GT: "502",
  HN: "504",
  IT: "39",
  MX: "52",
  NI: "505",
  PA: "507",
  PE: "51",
  PT: "351",
  PY: "595",
  US: "1",
  UY: "598",
  VE: "58"
};

export function dialCodeFromCountryIso(iso: string): string {
  const key = iso.trim().toUpperCase();
  const dial = COUNTRY_DIAL_CODES[key];
  if (!dial) {
    throw new Error(
      `País "${iso}" sem DDI configurado. Adicione o código do país ou use comprador do Brasil (BR).`
    );
  }
  return dial;
}

/** Números fictícios comuns em payloads de teste/sandbox (Hotmart, Postman). */
export function isLikelySandboxPhone(digits: string): boolean {
  const d = digits.replace(/\D/g, "");
  if (!d) return false;
  if (d === "99999999900" || d === "9999999999" || d === "99999999999") return true;
  if (/^9{10,}$/.test(d)) return true;
  return false;
}

/** Adiciona DDI 55 quando o número parece celular/fixo BR sem país. */
export function ensureBrazilCountryCode(digits: string): string {
  const d = digits.replace(/\D/g, "");
  if (!d) return d;
  if (d.startsWith("55") && d.length >= 12) return d;
  if ((d.length === 10 || d.length === 11) && /^[1-9][1-9]/.test(d)) {
    return `55${d}`;
  }
  return d;
}

export function normalizePhoneForWhatsApp(phone: string, countryIso = "BR"): string {
  const digits = phoneDigits(phone);
  if (digits.startsWith(dialCodeFromCountryIso(countryIso))) return digits;
  if (countryIso.toUpperCase() === "BR") return ensureBrazilCountryCode(digits);
  return `${dialCodeFromCountryIso(countryIso)}${digits}`;
}

export function assertValidBrazilWhatsAppPhone(phone: string): string {
  const digits = phoneDigits(phone);
  if (!digits) {
    throw new Error("Telefone vazio no fluxo.");
  }
  if (isLikelySandboxPhone(digits)) {
    throw new Error(
      "Número inválido: parece ser telefone de teste da Hotmart (ex.: 99999999900). Dispare o webhook com uma compra real ou um celular válido (55 + DDD + número)."
    );
  }
  if (!digits.startsWith("55")) {
    throw new Error(`Número inválido para WhatsApp BR (falta DDI 55). Recebido: ${phone}`);
  }
  const local = digits.slice(2);
  if (local.length < 10 || local.length > 11) {
    throw new Error(
      `Número brasileiro inválido (${digits}). Use 55 + DDD (2 dígitos) + celular (8 ou 9 dígitos).`
    );
  }
  const ddd = Number(local.slice(0, 2));
  if (ddd < 11 || ddd > 99) {
    throw new Error(`DDD inválido no telefone: ${local.slice(0, 2)}`);
  }
  return digits;
}

/** Variantes BR com/sem nono dígito do celular (WhatsApp vs Hotmart). */
export function brazilPhoneVariants(digits: string): string[] {
  const d = digits.replace(/\D/g, "");
  if (!d.startsWith("55") || d.length < 12) return [d];

  const variants = new Set<string>([d]);
  const local = d.slice(2);

  if (local.length === 11 && local[2] === "9") {
    variants.add(`55${local.slice(0, 2)}${local.slice(3)}`);
  }
  if (local.length === 10) {
    variants.add(`55${local.slice(0, 2)}9${local.slice(2)}`);
  }

  return [...variants];
}

/** Chaves para cruzar contato CRM ↔ chat WhatsApp. */
export function expandPhoneLookupKeys(phone: string): string[] {
  const digits = phoneDigits(phone);
  if (!digits) return [];

  const keys = new Set<string>([digits]);
  for (const variant of brazilPhoneVariants(digits)) {
    keys.add(variant);
  }

  const base = phone.trim();
  if (base.includes("@")) {
    keys.add(base);
    keys.add(base.split("@")[0] ?? "");
  }

  return [...keys].filter(Boolean);
}

export function firstNameFromFullName(fullName: string, fallback = "Cliente"): string {
  const trimmed = fullName.trim();
  if (!trimmed) return fallback;
  return trimmed.split(/\s+/)[0] ?? fallback;
}

export function assertValidWhatsAppPhone(phone: string, countryIso = "BR"): string {
  const iso = countryIso.toUpperCase();
  const digits = phoneDigits(phone);
  if (!digits) throw new Error("Telefone vazio no fluxo.");
  if (isLikelySandboxPhone(digits)) {
    throw new Error(
      "Número inválido: parece ser telefone de teste da Hotmart (ex.: 99999999900). Use uma compra real."
    );
  }
  if (iso === "BR") return assertValidBrazilWhatsAppPhone(digits);
  const dial = dialCodeFromCountryIso(iso);
  if (!digits.startsWith(dial)) {
    throw new Error(`Telefone sem DDI ${dial} para ${iso}. Recebido: ${phone}`);
  }
  const localLen = digits.length - dial.length;
  if (localLen < 8 || localLen > 12) {
    throw new Error(`Telefone inválido para ${iso} (${digits}).`);
  }
  return digits;
}
