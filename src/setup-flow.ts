// Guided setup in the private chat of the first Admin. Until the Apartment is
// set up, every interaction of theirs lands here and is steered to the current step.
import { Composer, InlineKeyboard, type Context, type MiddlewareFn } from "grammy";
import type { ChatState, ChatStates } from "./chat-states.ts";
import { formatDate } from "./clock.ts";
import { roomNameProblem, type Setup } from "./setup.ts";
import { SHOP_MODE_HINT, shopKeyboard } from "./shop-mode.ts";

type RoomsDraft = Extract<ChatState, { flow: "setup-rooms" }>;

export function guidedSetup(setup: Setup, chatStates: ChatStates, scannerUrl: string | null): MiddlewareFn<Context> {
  return async (ctx, next) => {
    if (!ctx.from || !ctx.chat) return next();
    const name = ctx.from.first_name;
    // The Operator's very first message, whatever it says, opens setup with the welcome.
    if (setup.startAsFirstAdmin(ctx.from.id, name)) return showRoomsStep(ctx, name, emptyDraft());

    const stage = setup.stage(ctx.from.id);
    if (stage === null) {
      // A setup button from an old message, tapped once the Apartment is set up.
      if (ctx.callbackQuery?.data?.startsWith("setup:")) {
        await ctx.answerCallbackQuery("Setup is already done.");
        return;
      }
      return next();
    }

    if (stage === "rooms") return roomsStep(ctx, ctx.chat.id, name);
    return ownRoomStep(ctx, ctx.from.id);
  };

  /** Step 1: the Admin types Room names, may reorder them, and confirms the Room Order. */
  async function roomsStep(ctx: Context, chatId: number, name: string): Promise<void> {
    const draft: RoomsDraft = chatStates.get(chatId) ?? emptyDraft();
    const text = ctx.message?.text;
    const action = ctx.callbackQuery?.data;

    if (text !== undefined && !text.startsWith("/")) {
      const names = text
        .split("\n")
        .map((line) => line.trim())
        .filter((name) => name !== "");
      const problems: string[] = [];
      for (const name of names) {
        const problem = roomNameProblem(name, draft.rooms);
        if (problem) problems.push(problem);
        else draft.rooms.push(name);
      }
      draft.reordered = null;
      chatStates.set(chatId, draft);
      const intro = problems.length > 0 ? `${problems.join("\n")}\n\n` : "";
      if (draft.rooms.length === 0) await ctx.reply(`${intro}Send me the Room names, one per line.`);
      else await ctx.reply(intro + draftText(draft), { reply_markup: draftButtons(draft) });
      return;
    }

    if (action === "setup:start-over" && draft.rooms.length > 0) {
      chatStates.clear(chatId);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText("Cleared. Send me the Room names again, one per line.");
      return;
    }

    if (action === "setup:reorder" && draft.rooms.length > 1) {
      draft.reordered = [];
      chatStates.set(chatId, draft);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(reorderText(draft.reordered), { reply_markup: reorderButtons(draft, draft.reordered) });
      return;
    }

    const picked = action?.match(/^setup:pick:(\d+)$/)?.[1];
    const pickedName = picked === undefined ? undefined : draft.rooms[Number(picked)];
    if (draft.reordered && pickedName !== undefined && !draft.reordered.includes(pickedName)) {
      draft.reordered.push(pickedName);
      if (draft.reordered.length === draft.rooms.length) {
        draft.rooms = draft.reordered;
        draft.reordered = null;
      }
      chatStates.set(chatId, draft);
      await ctx.answerCallbackQuery();
      if (draft.reordered) {
        await ctx.editMessageText(reorderText(draft.reordered), { reply_markup: reorderButtons(draft, draft.reordered) });
      } else {
        await ctx.editMessageText(draftText(draft), { reply_markup: draftButtons(draft) });
      }
      return;
    }

    if (action === "setup:cancel-reorder" && draft.reordered) {
      draft.reordered = null;
      chatStates.set(chatId, draft);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(draftText(draft), { reply_markup: draftButtons(draft) });
      return;
    }

    if (action === "setup:confirm" && draft.rooms.length > 0) {
      setup.confirmRooms(draft.rooms);
      chatStates.clear(chatId);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(`✅ Room Order confirmed:\n${numbered(draft.rooms)}`);
      await askForOwnRoom(ctx);
      return;
    }

    if (ctx.callbackQuery) return answerOutOfDate(ctx);
    // Anything else (/start, a photo…) shows step 1 again, with the Rooms typed so far.
    return showRoomsStep(ctx, name, draft);
  }

  async function showRoomsStep(ctx: Context, name: string, draft: RoomsDraft): Promise<void> {
    await ctx.reply(
      `👋 Welcome, ${name}! You're the first Admin of this Apartment. Two steps and it's ready.\n\n` +
        "Step 1 of 2: the Rooms. Send me their names, one per line. " +
        "The order you type them in becomes the Room Order, which every Rotation follows. " +
        "You can reorder them before confirming.",
    );
    if (draft.rooms.length > 0) await ctx.reply(draftText(draft), { reply_markup: draftButtons(draft) });
  }

  /** Step 2: the Admin picks their own Room, which completes setup. */
  async function ownRoomStep(ctx: Context, telegramId: number): Promise<void> {
    const roomId = ctx.callbackQuery?.data?.match(/^setup:own-room:(\d+)$/)?.[1];
    const stay = roomId === undefined ? null : setup.moveIntoOwnRoom(telegramId, Number(roomId));
    if (stay === null) {
      if (ctx.callbackQuery) return answerOutOfDate(ctx);
      return askForOwnRoom(ctx, "Setup isn't finished yet.\n\n");
    }

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`✅ You live in ${stay.room.name}, from today, ${formatDate(stay.moveIn)}.`);
    await ctx.reply(`🎉 The Apartment is set up. ${SHOP_MODE_HINT}`, { reply_markup: shopKeyboard(scannerUrl) });
    await ctx.reply(
      "Two more steps are optional. Do them now or whenever you like:\n" +
        "• Link the Apartment Group, so everyone hears when something runs out.\n" +
        "• Create Invites, so the other Residents can join their Rooms.",
      {
        reply_markup: new InlineKeyboard()
          .text("👥 Link the Apartment Group", "setup-optional:link")
          .row()
          .text("✉️ Create an Invite", "setup-optional:invite")
          .row()
          .text("⏭ Skip for now", "setup-optional:skip"),
      },
    );
  }

  /** Step 2's question, with a button per Room in Room Order. */
  async function askForOwnRoom(ctx: Context, intro = ""): Promise<void> {
    const keyboard = InlineKeyboard.from(
      setup.rooms().map((room) => [InlineKeyboard.text(room.name, `setup:own-room:${room.id}`)]),
    );
    await ctx.reply(`${intro}Step 2 of 2: which Room is yours?`, { reply_markup: keyboard });
  }
}

/** The optional steps offered once setup is done. The Admin is a Resident by then. */
export function optionalSetupSteps(): Composer<Context> {
  const composer = new Composer<Context>();
  composer.callbackQuery("setup-optional:link", (ctx) =>
    ctx.answerCallbackQuery("Linking the Apartment Group is coming soon."),
  );
  composer.callbackQuery("setup-optional:invite", (ctx) => ctx.answerCallbackQuery("Invites are coming soon."));
  composer.callbackQuery("setup-optional:skip", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Skipped. You can link the Apartment Group and create Invites later.");
  });
  return composer;
}

/** For a setup button that no longer matches where setup stands, e.g. tapped twice or on an older message. */
async function answerOutOfDate(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery("This button is out of date.");
}

function emptyDraft(): RoomsDraft {
  return { flow: "setup-rooms", rooms: [], reordered: null };
}

/** The Rooms typed so far, in Room Order. */
function draftText(draft: RoomsDraft): string {
  return (
    `Room Order:\n${numbered(draft.rooms)}\n\n` + "Send more names to add Rooms, or confirm when the order is right."
  );
}

/** Confirm, and the ways to change the Rooms before confirming. */
function draftButtons(draft: RoomsDraft): InlineKeyboard {
  const keyboard = new InlineKeyboard().text("✅ Confirm Room Order", "setup:confirm").row();
  if (draft.rooms.length > 1) keyboard.text("↕️ Reorder", "setup:reorder");
  return keyboard.text("🗑 Start over", "setup:start-over");
}

/** The reorder view: the Rooms tapped so far, in their new order. */
function reorderText(reordered: string[]): string {
  return ["Tap the Rooms in their new order.", ...(reordered.length > 0 ? [numbered(reordered)] : [])].join("\n");
}

/** A button per Room not tapped yet, keyed by its position in the typed order. */
function reorderButtons(draft: RoomsDraft, reordered: string[]): InlineKeyboard {
  const rows = draft.rooms.flatMap((name, index) =>
    reordered.includes(name) ? [] : [[InlineKeyboard.text(name, `setup:pick:${index}`)]],
  );
  return InlineKeyboard.from([...rows, [InlineKeyboard.text("↩️ Cancel", "setup:cancel-reorder")]]);
}

function numbered(names: string[]): string {
  return names.map((name, index) => `${index + 1}. ${name}`).join("\n");
}
