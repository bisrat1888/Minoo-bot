const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const AGENTS_FILE = path.join(DATA_DIR, "agents.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

const DEFAULT_PRODUCTS = [
  { id: "moringa", name: "Moringa", unitPrice: 150, minQty: 2 },
  { id: "qasil", name: "Qasil", unitPrice: 120, minQty: 2 },
  { id: "chia", name: "Chia", unitPrice: 200, minQty: 1 },
  { id: "mix", name: "ድብልቅ / Mixed", unitPrice: 180, minQty: 1 },
];

function ensureFile(file, fallback) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
}

function readJSON(file, fallback) {
  ensureFile(file, fallback);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ---------- Agents ----------
function getAgents() {
  return readJSON(AGENTS_FILE, []);
}
function saveAgents(agents) {
  writeJSON(AGENTS_FILE, agents);
}
function findAgentByTelegramId(telegramId) {
  return getAgents().find((a) => a.telegramId === telegramId);
}
function nextCode(agents) {
  let max = 0;
  agents.forEach((a) => {
    const m = /MINOO-(\d+)/.exec(a.code || "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return "MINOO-" + String(max + 1).padStart(3, "0");
}
function registerAgent({ telegramId, username, name, phone }) {
  const agents = getAgents();
  let agent = agents.find((a) => a.telegramId === telegramId);
  if (agent) return agent;
  agent = {
    code: nextCode(agents),
    telegramId,
    username: username || null,
    name: name || null,
    phone,
    joinedAt: Date.now(),
  };
  agents.push(agent);
  saveAgents(agents);
  return agent;
}

// ---------- Products ----------
function getProducts() {
  return readJSON(PRODUCTS_FILE, DEFAULT_PRODUCTS);
}
function saveProducts(products) {
  writeJSON(PRODUCTS_FILE, products);
}

// ---------- Orders ----------
function getOrders() {
  return readJSON(ORDERS_FILE, []);
}
function saveOrders(orders) {
  writeJSON(ORDERS_FILE, orders);
}
function addOrder(order) {
  const orders = getOrders();
  const withId = { ...order, id: "ORD-" + Date.now(), status: "pending", commissionPaid: false, createdAt: Date.now() };
  orders.unshift(withId);
  saveOrders(orders);
  return withId;
}
function updateOrderStatus(id, status) {
  const orders = getOrders();
  const idx = orders.findIndex((o) => o.id === id);
  if (idx === -1) return null;
  orders[idx].status = status;
  saveOrders(orders);
  return orders[idx];
}
function markCommissionPaid(id) {
  const orders = getOrders();
  const idx = orders.findIndex((o) => o.id === id);
  if (idx === -1) return null;
  orders[idx].commissionPaid = true;
  saveOrders(orders);
  return orders[idx];
}
function findOrderByShortId(shortId) {
  // allow admin to reference orders by the trailing digits, not the full ORD-<timestamp>
  const orders = getOrders();
  return orders.find((o) => o.id === shortId || o.id.endsWith(shortId));
}

// ---------- Settings ----------
function getSettings() {
  return readJSON(SETTINGS_FILE, { commissionPct: 10 });
}
function saveSettings(settings) {
  writeJSON(SETTINGS_FILE, settings);
}

module.exports = {
  getAgents, saveAgents, findAgentByTelegramId, registerAgent, nextCode,
  getProducts, saveProducts,
  getOrders, saveOrders, addOrder, updateOrderStatus, markCommissionPaid, findOrderByShortId,
  getSettings, saveSettings,
};
