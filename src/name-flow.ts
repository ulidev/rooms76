// A Resident's name, as the others see it. It starts as their Telegram first name
// and they can change it with /name.
import { Composer, InlineKeyboard, type Context } from "grammy";
import type { ChatStates } from "./chat-states.ts";
import { nameProblem, type Residents } from "./residents.ts";

export function renameFlow(residents: Residents, chatStates: ChatStates): Composer<Context> {
  const composer = new Composer<Context>();

  composer.command("name", async (ctx) => {
    const { name } = residents.current(ctx.from!.id)!;
    chatStates.set(ctx.chat.id, { flow: "rename" });
    await ctx.reply(`You're called ${name}. Send me your new name.`, {
      reply_markup: new InlineKeyboard().text(`↩️ Keep ${name}`, "name:keep"),
    });
  });

  composer.callbackQuery("name:keep", async (ctx) => {
    if (chatStates.get(ctx.chat!.id)?.flow === "rename") chatStates.clear(ctx.chat!.id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`OK, you're still ${residents.current(ctx.from.id)!.name}.`);
  });

  composer.on("message:text", async (ctx, next) => {
    if (chatStates.get(ctx.chat.id)?.flow !== "rename") return next();
    const name = ctx.message.text.trim();
    const problem = nameProblem(name);
    if (problem) {
      await ctx.reply(`${problem} Send me another one.`);
      return;
    }
    residents.rename(ctx.from.id, name);
    chatStates.clear(ctx.chat.id);
    await ctx.reply(`✅ I'll call you “${name}” from now on.`);
  });

  return composer;
}
