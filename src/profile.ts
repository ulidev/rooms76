// What Telegram shows about the bot. Set at startup, so the Operator only needs
// `/newbot` in BotFather.
import type { Api } from "grammy";

export const DESCRIPTION =
  "rooms76 helps the people sharing an apartment take turns buying the common items: " +
  "kitchen paper, dish soap, toilet paper and the like. It knows whose Turn it is, " +
  "tells the right Room when something runs out, and records Purchases by scanning the barcode.\n\n" +
  "To join, ask an Admin of your apartment for an Invite link.";

export const SHORT_DESCRIPTION = "Take turns buying your apartment's common items, room by room.";

export const ABOUT =
  "rooms76 helps the people sharing an apartment take turns buying the common items.\n\n" +
  "Product data comes from Open Food Facts (https://world.openfoodfacts.org), " +
  "available under the Open Database License (ODbL). " +
  "Product photos from Open Food Facts are available under " +
  "Creative Commons Attribution-ShareAlike 3.0 (CC BY-SA 3.0).\n\n" +
  "Source code (MIT): https://github.com/ulidev/rooms76";

export async function setUpProfile(api: Api): Promise<void> {
  await api.setMyCommands([
    { command: "start", description: "Open the bot" },
    { command: "about", description: "About rooms76 and its data sources" },
  ]);
  await api.setMyDescription(DESCRIPTION);
  await api.setMyShortDescription(SHORT_DESCRIPTION);
}
