require("dotenv").config();
const { Telegraf, Scenes, session, Markup } = require("telegraf");
const db = require("./db");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID; // group or your personal chat id, receives every new order
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean); // telegram user ids allowed to run admin commands

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN is missing. Set it in .env (see .env.example).");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

function money(n) {
  return Number(n || 0).toLocaleString("en-US") + " ብር";
}

function isAdmin(ctx) {
  return ADMIN_IDS.includes(String(ctx.from.id));
}

function mainMenu() {
  return Markup.keyboard([["🛒 አዲስ ትዕዛዝ"], ["📋 ትዕዛዞቼ"]]).resize();
}

function contactKeyboard() {
  return Markup.keyboard([Markup.button.contactRequest("📱 ስልክ ቁጥሬን አጋራ")])
    .resize()
    .oneTime();
}

// ---------- /start + registration ----------
bot.start(async (ctx) => {
  const agent = db.findAgentByTelegramId(String(ctx.from.id));
  if (agent) {
    await ctx.reply(
      `እንኳን ደህና መጣህ ${agent.name || ""}!\nኮድህ፡ ${agent.code}`,
      mainMenu()
    );
  } else {
    await ctx.reply(
      "እንኳን ወደ Minoo ወኪል ቦት በደህና መጣህ 🌿\n\nለመመዝገብ ስልክ ቁጥርህን አጋራ።",
      contactKeyboard()
    );
  }
});

bot.on("contact", async (ctx) => {
  const contact = ctx.message.contact;
  // Only accept the user's own contact, not a forwarded one
  if (contact.user_id && contact.user_id !== ctx.from.id) {
    return ctx.reply("እባክህ የራስህን ስልክ ቁጥር አጋራ።");
  }
  const agent = db.registerAgent({
    telegramId: String(ctx.from.id),
    username: ctx.from.username,
    name: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" "),
    phone: contact.phone_number,
  });
  await ctx.reply(
    `ተመዝግበሃል! ✅\nኮድህ፡ ${agent.code}\n\nትዕዛዝ አምጥተህ ገንዘብ ስንቀበል ኮሚሽን ትከፈላለህ።`,
    mainMenu()
  );
});

// ---------- Order wizard ----------
const orderWizard = new Scenes.WizardScene(
  "order-wizard",
  async (ctx) => {
    await ctx.reply("የደንበኛ ስም?", Markup.removeKeyboard());
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message?.text) return ctx.reply("ስም በጽሁፍ አስገባ።");
    ctx.wizard.state.order = { customerName: ctx.message.text.trim() };
    await ctx.reply("የደንበኛ ስልክ ቁጥር?");
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message?.text) return ctx.reply("ስልክ ቁጥር በጽሁፍ አስገባ።");
    ctx.wizard.state.order.customerPhone = ctx.message.text.trim();
    await ctx.reply("የደንበኛ አድራሻ? (ለምሳሌ: ቀበሌ 05, ልዩ ቦታ)");
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message?.text) return ctx.reply("አድራሻ በጽሁፍ አስገባ።");
    ctx.wizard.state.order.customerAddress = ctx.message.text.trim();
    const products = db.getProducts();
    ctx.wizard.state.products = products;
    await ctx.reply(
      "ምርት ምረጥ፦",
      Markup.inlineKeyboard(
        products.map((p) => [Markup.button.callback(`${p.name} — ${money(p.unitPrice)}/pc`, `prod:${p.id}`)])
      )
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    // waits for callback_query, handled by bot.action below which calls wizard.next() manually
    if (!ctx.wizard.state.selectedProduct) {
      return; // still waiting on the button press
    }
    if (!ctx.message?.text || isNaN(Number(ctx.message.text))) {
      return ctx.reply("ብዛት (pcs) ቁጥር በደንብ አስገባ።");
    }
    const qty = Number(ctx.message.text);
    const product = ctx.wizard.state.selectedProduct;
    if (qty < product.minQty) {
      return ctx.reply(`ዝቅተኛ ትዕዛዝ ${product.minQty} pcs ነው። እንደገና ብዛት አስገባ።`);
    }
    const total = qty * product.unitPrice;
    ctx.wizard.state.order.productId = product.id;
    ctx.wizard.state.order.productName = product.name;
    ctx.wizard.state.order.unitPrice = product.unitPrice;
    ctx.wizard.state.order.qty = qty;
    ctx.wizard.state.order.amount = total;

    const o = ctx.wizard.state.order;
    await ctx.reply(
      `ማረጋገጫ፦\nደንበኛ፡ ${o.customerName}\nስልክ፡ ${o.customerPhone}\nአድራሻ፡ ${o.customerAddress}\nምርት፡ ${o.productName} × ${o.qty}\nጠቅላላ ዋጋ፡ ${money(o.amount)}\n\nይህን ትዕዛዝ ላክ?`,
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ አረጋግጥ እና ላክ", "order:confirm")],
        [Markup.button.callback("❌ ሰርዝ", "order:cancel")],
      ])
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    // final step waits for confirm/cancel action
    return;
  }
);

orderWizard.action(/^prod:(.+)$/, async (ctx) => {
  const productId = ctx.match[1];
  const product = (ctx.wizard.state.products || db.getProducts()).find((p) => p.id === productId);
  if (!product) return ctx.answerCbQuery("ምርት አልተገኘም");
  ctx.wizard.state.selectedProduct = product;
  await ctx.answerCbQuery();
  await ctx.editMessageText(`${product.name} ተመርጧል — ${money(product.unitPrice)}/pc\nዝቅተኛ ብዛት፡ ${product.minQty} pcs`);
  await ctx.reply("ብዛት (pcs) አስገባ፦");
  return ctx.wizard.selectStep(4);
});

orderWizard.action("order:confirm", async (ctx) => {
  const agent = db.findAgentByTelegramId(String(ctx.from.id));
  if (!agent) {
    await ctx.answerCbQuery();
    return ctx.reply("እባክህ መጀመሪያ /start ብለህ ተመዝገብ።");
  }
  const order = db.addOrder({ ...ctx.wizard.state.order, agentCode: agent.code, agentName: agent.name, agentTelegramId: agent.telegramId });
  await ctx.answerCbQuery("ትዕዛዝ ተልኳል!");
  await ctx.editMessageText("ትዕዛዝህ ደርሶናል! በቅርቡ እናረጋግጣለን። ✅");
  await ctx.reply("ሌላ ትዕዛዝ ልትመዘግብ ትችላለህ።", mainMenu());

  if (ADMIN_CHAT_ID) {
    const shortId = order.id.slice(-6);
    await ctx.telegram.sendMessage(
      ADMIN_CHAT_ID,
      `🆕 አዲስ ትዕዛዝ #${shortId}\n\nወኪል፡ ${agent.name || agent.username || agent.code} (${agent.code})\nወኪል ስልክ፡ ${agent.phone}\n\nደንበኛ፡ ${order.customerName}\nስልክ፡ ${order.customerPhone}\nአድራሻ፡ ${order.customerAddress}\nምርት፡ ${order.productName} × ${order.qty}\nጠቅላላ ዋጋ፡ ${money(order.amount)}\n\nትዕዛዙን ለማዘመን፦ /confirm ${shortId}`
    );
  }
  return ctx.scene.leave();
});

orderWizard.action("order:cancel", async (ctx) => {
  await ctx.answerCbQuery("ተሰርዟል");
  await ctx.editMessageText("ትዕዛዙ ተሰርዟል።");
  await ctx.reply("ወደ ዋና ገጽ ተመልሰሃል።", mainMenu());
  return ctx.scene.leave();
});

const stage = new Scenes.Stage([orderWizard]);
bot.use(session());
bot.use(stage.middleware());

bot.hears("🛒 አዲስ ትዕዛዝ", async (ctx) => {
  const agent = db.findAgentByTelegramId(String(ctx.from.id));
  if (!agent) return ctx.reply("እባክህ መጀመሪያ /start ብለህ ተመዝገብ።");
  return ctx.scene.enter("order-wizard");
});

bot.hears("📋 ትዕዛዞቼ", async (ctx) => {
  const agent = db.findAgentByTelegramId(String(ctx.from.id));
  if (!agent) return ctx.reply("እባክህ መጀመሪያ /start ብለህ ተመዝገብ።");
  const myOrders = db.getOrders().filter((o) => o.agentCode === agent.code);
  if (myOrders.length === 0) return ctx.reply("እስካሁን ትዕዛዝ የለህም።");
  const statusLabel = { pending: "በመጠባበቅ", confirmed: "ተረጋግጧል", delivered: "ደርሷል", paid: "ገንዘብ ገብቷል" };
  const lines = myOrders.slice(0, 15).map((o) => {
    const commission = o.status === "paid" ? (o.commissionPaid ? " · ኮሚሽን ተከፍሏል" : " · ኮሚሽን በመጠባበቅ") : "";
    return `#${o.id.slice(-6)} — ${o.customerName} — ${o.productName}×${o.qty} — ${money(o.amount)} — ${statusLabel[o.status] || o.status}${commission}`;
  });
  return ctx.reply(lines.join("\n"));
});

// ---------- Admin commands ----------
function requireAdmin(handler) {
  return async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("ይህ ትዕዛዝ ለ admin ብቻ ነው።");
    return handler(ctx);
  };
}

bot.command(
  "pending",
  requireAdmin(async (ctx) => {
    const pending = db.getOrders().filter((o) => o.status === "pending");
    if (pending.length === 0) return ctx.reply("በመጠባበቅ ላይ ትዕዛዝ የለም።");
    const lines = pending.map(
      (o) => `#${o.id.slice(-6)} — ${o.customerName} (${o.customerPhone}) — ${o.productName}×${o.qty} — ${money(o.amount)} — ወኪል: ${o.agentCode}`
    );
    return ctx.reply(lines.join("\n"));
  })
);

function statusCommand(cmd, status, label) {
  bot.command(
    cmd,
    requireAdmin(async (ctx) => {
      const shortId = ctx.message.text.split(" ")[1];
      if (!shortId) return ctx.reply(`አጠቃቀም፦ /${cmd} <order id>`);
      const order = db.findOrderByShortId(shortId);
      if (!order) return ctx.reply("ትዕዛዝ አልተገኘም።");
      db.updateOrderStatus(order.id, status);
      await ctx.reply(`#${shortId} ➜ ${label} ✅`);
      if (order.agentTelegramId) {
        await ctx.telegram.sendMessage(order.agentTelegramId, `ትዕዛዝህ #${shortId} (${order.customerName}) ➜ ${label}`).catch(() => {});
      }
    })
  );
}
statusCommand("confirm", "confirmed", "ተረጋግጧል");
statusCommand("deliver", "delivered", "ደርሷል");
statusCommand("paid", "paid", "ገንዘብ ገብቷል");

bot.command(
  "commission",
  requireAdmin(async (ctx) => {
    const shortId = ctx.message.text.split(" ")[1];
    if (!shortId) return ctx.reply("አጠቃቀም፦ /commission <order id>");
    const order = db.findOrderByShortId(shortId);
    if (!order) return ctx.reply("ትዕዛዝ አልተገኘም።");
    db.markCommissionPaid(order.id);
    await ctx.reply(`#${shortId} ኮሚሽን ተከፍሏል ✅`);
  })
);

bot.command(
  "stats",
  requireAdmin(async (ctx) => {
    const orders = db.getOrders();
    const agents = db.getAgents();
    const settings = db.getSettings();
    const paid = orders.filter((o) => o.status === "paid");
    const revenue = paid.reduce((s, o) => s + o.amount, 0);
    const owed = paid.filter((o) => !o.commissionPaid).reduce((s, o) => s + o.amount * (settings.commissionPct / 100), 0);
    await ctx.reply(
      `📊 Minoo Stats\n\nወኪሎች፡ ${agents.length}\nትዕዛዞች፡ ${orders.length}\nበመጠባበቅ፡ ${orders.filter((o) => o.status === "pending").length}\nገቢ (ተከፍሏል)፡ ${money(revenue)}\nያልተከፈለ ኮሚሽን፡ ${money(Math.round(owed))}\nኮሚሽን መጠን፡ ${settings.commissionPct}%`
    );
  })
);

bot.command(
  "setcommission",
  requireAdmin(async (ctx) => {
    const pct = Number(ctx.message.text.split(" ")[1]);
    if (!pct || pct <= 0 || pct > 100) return ctx.reply("አጠቃቀም፦ /setcommission <ቁጥር, ለምሳሌ 10>");
    db.saveSettings({ ...db.getSettings(), commissionPct: pct });
    return ctx.reply(`የኮሚሽን መጠን ወደ ${pct}% ተቀይሯል።`);
  })
);

bot.command(
  "setprice",
  requireAdmin(async (ctx) => {
    const [, productId, price, minQty] = ctx.message.text.split(" ");
    if (!productId || !price) return ctx.reply("አጠቃቀም፦ /setprice <product_id> <ዋጋ> [minQty]");
    const products = db.getProducts();
    const idx = products.findIndex((p) => p.id === productId);
    if (idx === -1) return ctx.reply(`ምርት አልተገኘም። ID-ዎች፦ ${products.map((p) => p.id).join(", ")}`);
    products[idx].unitPrice = Number(price);
    if (minQty) products[idx].minQty = Number(minQty);
    db.saveProducts(products);
    return ctx.reply(`${products[idx].name} ➜ ${money(products[idx].unitPrice)}/pc, ዝቅተኛ ${products[idx].minQty} pcs`);
  })
);

bot.command(
  "agents",
  requireAdmin(async (ctx) => {
    const agents = db.getAgents();
    if (agents.length === 0) return ctx.reply("እስካሁን ወኪል የለም።");
    const orders = db.getOrders();
    const lines = agents.map((a) => {
      const count = orders.filter((o) => o.agentCode === a.code).length;
      return `${a.code} — ${a.name || a.username || "?"} — ${a.phone} — ${count} ትዕዛዝ`;
    });
    return ctx.reply(lines.join("\n"));
  })
);

bot.help((ctx) => {
  if (isAdmin(ctx)) {
    return ctx.reply(
      "Admin commands:\n/pending — pending orders\n/confirm <id>\n/deliver <id>\n/paid <id> — mark money received\n/commission <id> — mark commission paid\n/stats\n/setcommission <pct>\n/setprice <product_id> <price> [minQty]\n/agents"
    );
  }
  return ctx.reply("/start ብለህ ጀምር፣ ከዛ 🛒 አዲስ ትዕዛዝ ተጫን።");
});

bot.launch();
console.log("Minoo bot is running...");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
