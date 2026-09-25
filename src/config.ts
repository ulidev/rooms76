// The Operator configures the bot only through environment variables. They are
// validated at startup, and every problem is reported at once so the Operator
// can fix the whole config in one go.

/** The shared scanner page pinned by this release. */
export const DEFAULT_SCANNER_URL = "https://ulidev.github.io/rooms76/scanner/v1/";

export interface Config {
  botToken: string;
  operatorTelegramId: number;
  /** IANA name; defines "today" for Stays, move-outs and the reminder. */
  apartmentTimeZone: string;
  /** Contact for the Open Food Facts User-Agent. */
  offContact: string;
  /** Null hides the Scan button. */
  scannerUrl: string | null;
}

export class ConfigError extends Error {
  constructor(problems: string[]) {
    super(["rooms76 can't start. Fix these environment variables:", ...problems.map((p) => `- ${p}`)].join("\n"));
    this.name = "ConfigError";
  }
}

export function readConfig(env: Record<string, string | undefined>): Config {
  const problems: string[] = [];
  const value = (name: string) => env[name]?.trim() || undefined;

  const botToken = value("BOT_TOKEN");
  if (!botToken) problems.push("BOT_TOKEN is missing. Get it from @BotFather.");
  else if (!/^\d+:[\w-]{30,}$/.test(botToken)) {
    problems.push("BOT_TOKEN doesn't look like a bot token from @BotFather (e.g. 123456789:AAE...).");
  }

  const operatorTelegramId = value("OPERATOR_TELEGRAM_ID");
  if (!operatorTelegramId) {
    problems.push("OPERATOR_TELEGRAM_ID is missing. It's your numeric Telegram user id.");
  } else if (!/^[1-9]\d*$/.test(operatorTelegramId) || !Number.isSafeInteger(Number(operatorTelegramId))) {
    problems.push(`OPERATOR_TELEGRAM_ID "${operatorTelegramId}" is not a numeric Telegram user id.`);
  }

  const apartmentTimeZone = value("APARTMENT_TIMEZONE");
  if (!apartmentTimeZone) {
    problems.push("APARTMENT_TIMEZONE is missing. Use an IANA time zone name, e.g. Europe/Berlin.");
  } else if (!isIanaTimeZone(apartmentTimeZone)) {
    problems.push(`APARTMENT_TIMEZONE "${apartmentTimeZone}" is not an IANA time zone name, e.g. Europe/Berlin.`);
  }

  const offContact = value("OFF_CONTACT");
  if (!offContact) problems.push("OFF_CONTACT is missing. Use an email or URL where Open Food Facts can reach you.");

  // Unset means the shared page; empty hides the Scan button; anything else overrides it.
  const scannerUrl = env.SCANNER_URL === undefined ? DEFAULT_SCANNER_URL : env.SCANNER_URL.trim() || null;
  if (scannerUrl !== null && !isHttpsUrl(scannerUrl)) {
    problems.push(`SCANNER_URL "${scannerUrl}" must be an https:// URL, or empty to hide the Scan button.`);
  }

  if (problems.length > 0) throw new ConfigError(problems);
  return {
    botToken: botToken!,
    operatorTelegramId: Number(operatorTelegramId),
    apartmentTimeZone: apartmentTimeZone!,
    offContact: offContact!,
    scannerUrl,
  };
}

function isIanaTimeZone(name: string): boolean {
  // Intl also accepts UTC offsets such as "+01:00"; only names are wanted here.
  if (!/^[A-Za-z]/.test(name)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

function isHttpsUrl(value: string): boolean {
  return URL.canParse(value) && new URL(value).protocol === "https:";
}
