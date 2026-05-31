import { getByPath, asString } from "./jsonPathLite.js";
import {
  dialCodeFromCountryIso,
  ensureBrazilMobileNineDigits,
  isLikelySandboxPhone,
  phoneDigits
} from "./phone.js";

/** Hotmart v2: checkout_phone_code = DDD; país em purchase.checkout_country ou buyer.address. */
const COUNTRY_ISO_PATHS = [
  "$.data.purchase.checkout_country.iso",
  "$.data.buyer.address.country_iso",
  "$.purchase.checkout_country.iso",
  "$.buyer.address.country_iso"
] as const;

const CHECKOUT_PHONE_PATHS = [
  "$.data.buyer.checkout_phone",
  "$.data.buyer.phone",
  "$.buyer.checkout_phone",
  "$.buyer.phone"
] as const;

function hotmartBuyer(payload: unknown): Record<string, unknown> | null {
  const buyer = getByPath(payload, "$.data.buyer") ?? getByPath(payload, "$.buyer");
  if (buyer && typeof buyer === "object" && !Array.isArray(buyer)) {
    return buyer as Record<string, unknown>;
  }
  return null;
}

export function resolveHotmartCountryIso(payload: unknown): string {
  for (const path of COUNTRY_ISO_PATHS) {
    const iso = asString(getByPath(payload, path))?.trim().toUpperCase();
    if (iso && /^[A-Z]{2}$/.test(iso)) return iso;
  }
  return "BR";
}

function buildNationalNumber(local: string, areaCode: string): string {
  const digits = phoneDigits(local);
  const ddd = phoneDigits(areaCode);
  if (!digits) return "";

  if (!ddd) return digits;

  // checkout_phone já inclui o DDD (ex.: 66996326512 + code 66)
  if (digits.startsWith(ddd) && (digits.length === 10 || digits.length === 11)) {
    return digits;
  }

  // Só o assinante (8 ou 9 dígitos) — prefixa DDD
  if (digits.length === 8 || digits.length === 9) {
    return `${ddd}${digits}`;
  }

  // Número completo sem DDD coincidente — não duplica o code
  if (digits.length >= 10) return digits;

  return `${ddd}${digits}`;
}

function buildInternationalPhone(national: string, countryIso: string): string {
  const iso = countryIso.toUpperCase();
  const dial = dialCodeFromCountryIso(iso);
  let local = phoneDigits(national);
  if (!local) return "";

  if (iso === "BR") {
    local = ensureBrazilMobileNineDigits(local);
  }

  if (local.startsWith(dial)) return local;
  return `${dial}${local}`;
}

/**
 * Monta telefone E.164 a partir do payload Hotmart v2.
 * Usa país (ISO → DDI), checkout_phone_code (DDD) e checkout_phone.
 */
export function resolveHotmartPhone(payload: unknown, phonePath?: string): string {
  const countryIso = resolveHotmartCountryIso(payload);
  const buyer = hotmartBuyer(payload);

  const areaCode = phoneDigits(
    asString(buyer?.checkout_phone_code ?? buyer?.phone_code) ?? ""
  );

  const fromMapping = phonePath
    ? phoneDigits(asString(getByPath(payload, phonePath)) ?? "")
    : "";

  let local = fromMapping;
  if (!local && buyer) {
    for (const key of ["checkout_phone", "phone", "telephone", "cellphone"] as const) {
      const hit = phoneDigits(asString(buyer[key]) ?? "");
      if (hit.length >= 8) {
        local = hit;
        break;
      }
    }
  }

  if (!local) {
    for (const path of CHECKOUT_PHONE_PATHS) {
      const hit = phoneDigits(asString(getByPath(payload, path)) ?? "");
      if (hit.length >= 8) {
        local = hit;
        break;
      }
    }
  }

  if (!local) return "";

  const national = buildNationalNumber(local, areaCode);
  const international = buildInternationalPhone(national, countryIso);

  if (isLikelySandboxPhone(international)) return international;
  return international;
}
