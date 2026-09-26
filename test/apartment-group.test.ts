import { afterEach, expect, test } from "vitest";
import { OPERATOR_ID, startTestBot, type TestBot } from "./harness.ts";

let bot: TestBot;
afterEach(() => bot.close());

const lena = { id: OPERATOR_ID, first_name: "Lena" };
const group = { id: -4001, title: "Flat 76" };

const LINKED =
  "📌 This is now the Apartment Group. I'll post here only when something runs out, and when it's bought. " +
  "Everything else happens in your private chat with me.";

/** A fresh Apartment set up by Lena, the Operator and first Admin, who lives in Room 2. */
async function apartmentSetUpByLena(): Promise<void> {
  bot = await startTestBot();
  await bot.sendPrivateMessage(lena, "/start");
  await bot.sendPrivateMessage(lena, "Room 1\nRoom 2\nAttic");
  await bot.tap(lena, "✅ Confirm Room Order");
  await bot.tap(lena, "Room 2");
}

test("an Admin adding the bot to a group, while no group is linked, links it", async () => {
  await apartmentSetUpByLena();

  await bot.addBotToGroup(lena, group);

  expect(bot.messagesTo(group.id)).toEqual([LINKED]);
  expect(bot.isInGroup(group.id)).toBe(true);
});

const ana = { id: 2002, first_name: "Ana" };

/** Lena invites Ana to the Attic, and Ana joins. */
async function anaJoins(): Promise<void> {
  await bot.sendPrivateMessage(lena, "/invites");
  await bot.tap(lena, "✉️ New Invite");
  await bot.tap(lena, "Attic");
  await bot.tap(lena, bot.lastMessageTo(lena.id).buttons.flat().find((text) => text.startsWith("Today, "))!);
  const link = bot.lastMessageTo(lena.id).text.match(/https:\/\/t\.me\/\S+/)![0];
  await bot.sendPrivateMessage(ana, `/start ${new URL(link).searchParams.get("start")}`);
}

const LEAVING_NOT_ADMIN = "👋 Only an Admin of the Apartment can add me to a group, so I'm leaving.";

test("the bot leaves a group a Resident who isn't an Admin added it to, and links nothing", async () => {
  await apartmentSetUpByLena();
  await anaJoins();

  await bot.addBotToGroup(ana, group);

  expect(bot.messagesTo(group.id)).toEqual([LEAVING_NOT_ADMIN]);
  expect(bot.isInGroup(group.id)).toBe(false);

  // Nothing was linked: Lena adding it later links the group.
  await bot.addBotToGroup(lena, group);
  expect(bot.messagesTo(group.id).at(-1)).toBe(LINKED);
});

test("the bot leaves a group someone who isn't a Resident added it to", async () => {
  await apartmentSetUpByLena();

  await bot.addBotToGroup({ id: 9009, first_name: "Stranger" }, group);

  expect(bot.messagesTo(group.id)).toEqual([LEAVING_NOT_ADMIN]);
  expect(bot.isInGroup(group.id)).toBe(false);
});

const otherGroup = { id: -4002, title: "Flat 76 (new)" };

const WAITING_FOR_LINK =
  "This Apartment already has an Apartment Group, Flat 76. " +
  "To move it here, an Admin sends /link@rooms76_test_bot. Otherwise I'll leave.";

test("an Admin adding the bot to another group, while one is linked, is asked to /link it there", async () => {
  await apartmentSetUpByLena();
  await bot.addBotToGroup(lena, group);

  await bot.addBotToGroup(lena, otherGroup);

  expect(bot.messagesTo(otherGroup.id)).toEqual([WAITING_FOR_LINK]);
  expect(bot.isInGroup(otherGroup.id)).toBe(true);
  expect(bot.messagesTo(group.id)).toEqual([LINKED]);
});

test("/link from an Admin in the other group re-links, and the bot leaves the previous group", async () => {
  await apartmentSetUpByLena();
  await bot.addBotToGroup(lena, group);
  await bot.addBotToGroup(lena, otherGroup);

  await bot.sendGroupMessage(lena, otherGroup, "/link");

  expect(bot.messagesTo(otherGroup.id)).toEqual([WAITING_FOR_LINK, LINKED]);
  expect(bot.messagesTo(group.id)).toEqual([
    LINKED,
    "👋 The Apartment Group moved to Flat 76 (new), so I'm leaving this group.",
  ]);
  expect(bot.isInGroup(group.id)).toBe(false);
  expect(bot.isInGroup(otherGroup.id)).toBe(true);
});

test("when the next thing the bot hears in the other group isn't /link from an Admin, it leaves", async () => {
  await apartmentSetUpByLena();
  await anaJoins();
  await bot.addBotToGroup(lena, group);
  await bot.addBotToGroup(lena, otherGroup);

  await bot.sendGroupMessage(ana, otherGroup, "/link");

  expect(bot.messagesTo(otherGroup.id)).toEqual([
    WAITING_FOR_LINK,
    "👋 Only Admins can link the Apartment Group, so I'm leaving. The Apartment Group is still Flat 76.",
  ]);
  expect(bot.isInGroup(otherGroup.id)).toBe(false);
  expect(bot.messagesTo(group.id)).toEqual([LINKED]);
  expect(bot.isInGroup(group.id)).toBe(true);
});

test("any other command in the other group makes the bot leave too", async () => {
  await apartmentSetUpByLena();
  await bot.addBotToGroup(lena, group);
  await bot.addBotToGroup(lena, otherGroup);

  await bot.sendGroupMessage(lena, otherGroup, "/start");

  expect(bot.messagesTo(otherGroup.id)).toEqual([
    WAITING_FOR_LINK,
    "👋 No Admin sent /link, so I'm leaving. The Apartment Group is still Flat 76.",
  ]);
  expect(bot.isInGroup(otherGroup.id)).toBe(false);
});

test("removing the bot from the Apartment Group unlinks it, so an Admin can link another group by adding the bot", async () => {
  await apartmentSetUpByLena();
  await bot.addBotToGroup(lena, group);

  await bot.removeBotFromGroup(lena, group);
  await bot.addBotToGroup(lena, otherGroup);

  expect(bot.messagesTo(otherGroup.id)).toEqual([LINKED]);
});

test("/link in the Apartment Group says it's already linked, and only Admins may send it", async () => {
  await apartmentSetUpByLena();
  await anaJoins();
  await bot.addBotToGroup(lena, group);

  await bot.sendGroupMessage(lena, group, "/link");
  await bot.sendGroupMessage(ana, group, "/link@rooms76_test_bot");

  expect(bot.messagesTo(group.id)).toEqual([
    LINKED,
    "This is already the Apartment Group.",
    "Only Admins can link the Apartment Group.",
  ]);
  expect(bot.isInGroup(group.id)).toBe(true);
});

test("the link follows the Apartment Group when Telegram upgrades it to a supergroup", async () => {
  await apartmentSetUpByLena();
  await bot.addBotToGroup(lena, group);
  const supergroup = { id: -1004001, title: group.title };

  await bot.upgradeToSupergroup(group, supergroup.id);
  await bot.sendGroupMessage(lena, supergroup, "/link");

  expect(bot.messagesTo(supergroup.id)).toEqual(["This is already the Apartment Group."]);
  expect(bot.isInGroup(supergroup.id)).toBe(true);
});

test("the bot knows the Apartment Group by its current name", async () => {
  await apartmentSetUpByLena();
  await bot.addBotToGroup(lena, group);

  await bot.renameGroup(lena, group, "Flat 76 🏠");
  await bot.addBotToGroup(lena, otherGroup);

  expect(bot.messagesTo(otherGroup.id)).toEqual([
    "This Apartment already has an Apartment Group, Flat 76 🏠. " +
      "To move it here, an Admin sends /link@rooms76_test_bot. Otherwise I'll leave.",
  ]);
});

test("a new Resident is told to ask to be added to the Apartment Group, when the bot can't invite them", async () => {
  await apartmentSetUpByLena();
  await bot.addBotToGroup(lena, group);

  await anaJoins();

  expect(bot.messagesTo(ana.id)).toEqual([
    expect.stringMatching(/^👋 Welcome, Ana! You live in Attic/),
    "👥 Ask another Resident to add you to the Apartment Group, Flat 76. I post there when something runs out.",
  ]);
});

test("a new Resident gets a single-use link to join the Apartment Group, when the bot may invite users there", async () => {
  await apartmentSetUpByLena();
  await bot.addBotToGroup(lena, group, { asGroupAdmin: true });

  await anaJoins();

  expect(bot.messagesTo(ana.id)).toEqual([
    expect.stringMatching(/^👋 Welcome, Ana! You live in Attic/),
    "👥 Join the Apartment Group, Flat 76. I post there when something runs out:\nhttps://t.me/+fakeInvite1",
  ]);
  expect(bot.calls.find((call) => call.method === "createChatInviteLink")?.payload).toMatchObject({
    chat_id: group.id,
    member_limit: 1,
  });
});

test("while no group is linked, nothing is sent to any group and new Residents hear nothing about one", async () => {
  await apartmentSetUpByLena();
  await bot.addBotToGroup(lena, group, { asGroupAdmin: true });
  await bot.removeBotFromGroup(lena, group);

  await anaJoins();

  expect(bot.messagesTo(ana.id)).toEqual([expect.stringMatching(/^👋 Welcome, Ana! You live in Attic/)]);
  expect(bot.messagesTo(group.id)).toEqual([LINKED]);
  expect(bot.calls.filter((call) => call.method === "createChatInviteLink")).toEqual([]);
});

const GROUP_ADMIN_TIP =
  "To let me give new Residents a link to join the group, make me a group admin who can invite users.";

test("/link in private tells an Admin how to link the Apartment Group, and which one is linked", async () => {
  await apartmentSetUpByLena();

  await bot.sendPrivateMessage(lena, "/link");
  expect(bot.lastMessageTo(lena.id).text).toBe(
    "👥 No Apartment Group is linked yet. To link it, add me to the group: " +
      "open it, tap Add members and pick @rooms76_test_bot.\n\n" +
      GROUP_ADMIN_TIP,
  );

  await bot.addBotToGroup(lena, group);
  await bot.sendPrivateMessage(lena, "/link");
  expect(bot.lastMessageTo(lena.id).text).toBe(
    "👥 The Apartment Group is Flat 76. To move it to another group, add me there and send /link@rooms76_test_bot in it.\n\n" +
      GROUP_ADMIN_TIP,
  );
});

test("only Admins may link the Apartment Group", async () => {
  await apartmentSetUpByLena();
  await anaJoins();

  await bot.sendPrivateMessage(ana, "/link");

  expect(bot.lastMessageTo(ana.id).text).toBe("Only Admins can link the Apartment Group.");
});

test("an anonymous group admin's /link is answered with how to link, and the bot keeps waiting", async () => {
  await apartmentSetUpByLena();
  await bot.addBotToGroup(lena, group);
  await bot.addBotToGroup(lena, otherGroup);

  await bot.sendAnonymousGroupMessage(otherGroup, "/link");

  expect(bot.messagesTo(otherGroup.id)).toEqual([
    WAITING_FOR_LINK,
    "I can't tell who sent /link while they stay anonymous. An Admin needs to send it as themselves.",
  ]);
  expect(bot.isInGroup(otherGroup.id)).toBe(true);

  await bot.sendGroupMessage(lena, otherGroup, "/link");
  expect(bot.messagesTo(otherGroup.id).at(-1)).toBe(LINKED);
});

test("the link follows the Apartment Group to its supergroup, even when Telegram first reports the bot as added there", async () => {
  await apartmentSetUpByLena();
  await anaJoins();
  await bot.addBotToGroup(lena, group);
  const supergroup = { id: -1004001, title: group.title };

  // Ana, a group admin but not an Admin of the Apartment, makes the bot a group admin, which upgrades the group.
  await bot.upgradeToSupergroup(group, supergroup.id, { botAddedFirstBy: ana });
  await bot.sendGroupMessage(lena, supergroup, "/link");

  expect(bot.messagesTo(supergroup.id)).toEqual(["This is already the Apartment Group."]);
  expect(bot.isInGroup(supergroup.id)).toBe(true);
});

test("the bot leaves a group it can't post in, rather than wait there silently for /link", async () => {
  await apartmentSetUpByLena();
  await bot.addBotToGroup(lena, group);

  await bot.addBotToGroup(lena, otherGroup, { mayPost: false });

  expect(bot.isInGroup(otherGroup.id)).toBe(false);
  expect(bot.isInGroup(group.id)).toBe(true);
});
