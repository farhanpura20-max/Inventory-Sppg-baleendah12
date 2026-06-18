const STORAGE_KEY = "sppg_baleendah_12_inventory_v1";
let state = loadState();
let editingItemId = null;
let currentReportRows = [];
let currentReportHeaders = [];
let supabaseClient = null;
let syncTimer = null;
let onlineReady = false;


const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseDate(value) {
  if (!value) return null;
  return new Date(`${value}T00:00:00`);
}

function formatDate(value) {
  if (!value) return "-";
  const date = parseDate(value);
  if (!date || Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

function formatNumber(value) {
  const num = Number(value || 0);
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(num);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function daysUntil(dateValue) {
  const date = parseDate(dateValue);
  if (!date) return 99999;
  const now = parseDate(todayISO());
  return Math.ceil((date - now) / (1000 * 60 * 60 * 24));
}

function expStatus(expDate) {
  const day = daysUntil(expDate);
  if (day < 0) return { label: "Expired", className: "danger" };
  if (day <= 7) return { label: "Segera Exp", className: "warn" };
  return { label: "Aman", className: "ok" };
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch (err) { console.warn("Data local rusak, memakai data demo.", err); }
  }
  return getSeedData();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  queueOnlineSync();
}

function getSupabaseConfig() {
  const config = window.SPPG_SUPABASE || {};
  const runtimeConfig = JSON.parse(localStorage.getItem("sppg_supabase_runtime_config") || "{}");
  return { ...config, ...runtimeConfig };
}

function hasSupabaseConfig() {
  const config = getSupabaseConfig();
  return Boolean(
    config.url &&
    config.anonKey &&
    !String(config.url).includes("ISI_SUPABASE") &&
    !String(config.anonKey).includes("ISI_SUPABASE")
  );
}

function ensureSyncStatus() {
  if ($("#syncStatus")) return;
  const target = $(".topbar-actions");
  if (!target) return;
  const badge = document.createElement("span");
  badge.id = "syncStatus";
  badge.className = "sync-status warn";
  badge.textContent = "Mode lokal";
  target.prepend(badge);
}

function setSyncStatus(text, className = "warn") {
  ensureSyncStatus();
  const badge = $("#syncStatus");
  if (!badge) return;
  badge.className = `sync-status ${className}`;
  badge.textContent = text;
}

async function initOnlineDatabase() {
  ensureSyncStatus();
  if (!hasSupabaseConfig()) {
    setSyncStatus("Mode lokal", "warn");
    return;
  }
  if (!window.supabase) {
    setSyncStatus("Supabase CDN gagal dimuat", "danger");
    return;
  }

  const config = getSupabaseConfig();
  try {
    supabaseClient = window.supabase.createClient(config.url, config.anonKey);
    setSyncStatus("Menghubungkan database", "warn");
    await loadOnlineState();
  } catch (err) {
    console.error(err);
    supabaseClient = null;
    onlineReady = false;
    setSyncStatus("Database gagal terhubung", "danger");
    showToast("Database online belum terhubung. Aplikasi tetap memakai data lokal.");
  }
}

async function loadOnlineState() {
  if (!supabaseClient) return;
  const config = getSupabaseConfig();
  const table = config.table || "inventory_state";
  const recordKey = config.recordKey || "sppg-baleendah-12";

  const { data, error } = await supabaseClient
    .from(table)
    .select("data, updated_at")
    .eq("id", recordKey)
    .maybeSingle();

  if (error) throw error;

  if (data?.data) {
    state = normalizeState(data.data);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    onlineReady = true;
    setSyncStatus("Online database aktif", "ok");
    renderAll();
    showToast("Data online berhasil dimuat.");
    return;
  }

  onlineReady = true;
  await saveOnlineStateNow();
  setSyncStatus("Online database aktif", "ok");
  showToast("Database online masih kosong. Data awal sudah dikirim ke database.");
}

function normalizeState(data) {
  const fallback = getSeedData();
  return {
    items: Array.isArray(data?.items) ? data.items : fallback.items,
    purchases: Array.isArray(data?.purchases) ? data.purchases : [],
    lots: Array.isArray(data?.lots) ? data.lots : [],
    usages: Array.isArray(data?.usages) ? data.usages : [],
    opnames: Array.isArray(data?.opnames) ? data.opnames : []
  };
}

function queueOnlineSync() {
  if (!supabaseClient || !onlineReady) return;
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => saveOnlineStateNow(), 500);
}

async function saveOnlineStateNow() {
  if (!supabaseClient) return;
  const config = getSupabaseConfig();
  const table = config.table || "inventory_state";
  const recordKey = config.recordKey || "sppg-baleendah-12";
  try {
    setSyncStatus("Menyimpan data", "warn");
    const { error } = await supabaseClient
      .from(table)
      .upsert({
        id: recordKey,
        data: state,
        updated_at: new Date().toISOString()
      });
    if (error) throw error;
    setSyncStatus("Online database aktif", "ok");
  } catch (err) {
    console.error(err);
    setSyncStatus("Sinkronisasi gagal", "danger");
    showToast("Data tersimpan lokal, tetapi gagal sinkron ke database online.");
  }
}

function getSeedData() {
  const items = [
    { id: "BRG-001", name: "Beras Premium", category: "Karbohidrat", unit: "kg", minStock: 50, createdAt: todayISO() },
    { id: "BRG-002", name: "Ayam Fillet", category: "Protein Hewani", unit: "kg", minStock: 20, createdAt: todayISO() },
    { id: "BRG-003", name: "Telur Ayam", category: "Protein Hewani", unit: "pcs", minStock: 120, createdAt: todayISO() },
    { id: "BRG-004", name: "Wortel", category: "Sayuran", unit: "kg", minStock: 15, createdAt: todayISO() },
    { id: "BRG-005", name: "Minyak Goreng", category: "Bahan Pendukung", unit: "liter", minStock: 10, createdAt: todayISO() },
    { id: "BRG-006", name: "Gula Pasir", category: "Bumbu", unit: "kg", minStock: 8, createdAt: todayISO() }
  ];

  const purchases = [
    { id: "PB-001", date: todayISO(), itemId: "BRG-001", qty: 150, unitPrice: 14500, total: 2175000, expDate: addDaysISO(120), supplier: "Toko Sembako Baleendah", note: "Stok awal" },
    { id: "PB-002", date: todayISO(), itemId: "BRG-002", qty: 35, unitPrice: 38000, total: 1330000, expDate: addDaysISO(5), supplier: "Supplier Ayam", note: "Batch pendingin" },
    { id: "PB-003", date: todayISO(), itemId: "BRG-003", qty: 300, unitPrice: 1900, total: 570000, expDate: addDaysISO(14), supplier: "Peternak Lokal", note: "Tray telur" },
    { id: "PB-004", date: todayISO(), itemId: "BRG-004", qty: 25, unitPrice: 12000, total: 300000, expDate: addDaysISO(6), supplier: "Pasar Induk", note: "Sayur segar" },
    { id: "PB-005", date: todayISO(), itemId: "BRG-005", qty: 18, unitPrice: 17500, total: 315000, expDate: addDaysISO(180), supplier: "Distributor", note: "Dus minyak" },
    { id: "PB-006", date: todayISO(), itemId: "BRG-006", qty: 12, unitPrice: 16000, total: 192000, expDate: addDaysISO(210), supplier: "Toko Sembako Baleendah", note: "Stok awal" }
  ];

  const lots = purchases.map((purchase, index) => ({
    id: `LOT-${String(index + 1).padStart(3, "0")}`,
    purchaseId: purchase.id,
    itemId: purchase.itemId,
    qty: purchase.qty,
    remainingQty: purchase.qty,
    unitPrice: purchase.unitPrice,
    expDate: purchase.expDate,
    date: purchase.date,
    source: "pembelian"
  }));

  return { items, purchases, lots, usages: [], opnames: [] };
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function getItem(itemId) {
  return state.items.find(item => item.id === itemId);
}

function itemName(itemId) {
  return getItem(itemId)?.name || "Barang tidak ditemukan";
}

function itemUnit(itemId) {
  return getItem(itemId)?.unit || "";
}

function stockByItem(itemId) {
  return state.lots
    .filter(lot => lot.itemId === itemId)
    .reduce((sum, lot) => sum + Number(lot.remainingQty || 0), 0);
}

function valueByItem(itemId) {
  return state.lots
    .filter(lot => lot.itemId === itemId)
    .reduce((sum, lot) => sum + Number(lot.remainingQty || 0) * Number(lot.unitPrice || 0), 0);
}

function availableLots(itemId) {
  return state.lots
    .filter(lot => lot.itemId === itemId && Number(lot.remainingQty) > 0)
    .sort((a, b) => String(a.expDate).localeCompare(String(b.expDate)) || String(a.date).localeCompare(String(b.date)));
}

function averageCost(itemId) {
  const lots = state.lots.filter(lot => lot.itemId === itemId && Number(lot.remainingQty) > 0);
  const qty = lots.reduce((sum, lot) => sum + Number(lot.remainingQty || 0), 0);
  if (!qty) return 0;
  const value = lots.reduce((sum, lot) => sum + Number(lot.remainingQty || 0) * Number(lot.unitPrice || 0), 0);
  return Math.round(value / qty);
}

function reduceLots(itemId, qty) {
  const requested = Number(qty);
  const total = stockByItem(itemId);
  if (requested <= 0) throw new Error("Jumlah harus lebih dari 0.");
  if (total + 0.0001 < requested) throw new Error(`Stok ${itemName(itemId)} tidak mencukupi. Stok tersedia ${formatNumber(total)} ${itemUnit(itemId)}.`);

  let remaining = requested;
  const usedLots = [];
  availableLots(itemId).forEach(lot => {
    if (remaining <= 0) return;
    const take = Math.min(Number(lot.remainingQty), remaining);
    lot.remainingQty = Number((Number(lot.remainingQty) - take).toFixed(4));
    remaining = Number((remaining - take).toFixed(4));
    usedLots.push({ lotId: lot.id, qty: take, expDate: lot.expDate, unitPrice: lot.unitPrice });
  });
  return usedLots;
}

function restoreLots(usedLots) {
  usedLots.forEach(used => {
    const lot = state.lots.find(item => item.id === used.lotId);
    if (lot) lot.remainingQty = Number((Number(lot.remainingQty || 0) + Number(used.qty || 0)).toFixed(4));
  });
}

function setDefaultDates() {
  ["#purchaseDate", "#usageDate", "#opnameDate", "#reportEnd"].forEach(selector => {
    const field = $(selector);
    if (field && !field.value) field.value = todayISO();
  });
  const start = $("#reportStart");
  if (start && !start.value) start.value = new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().slice(0, 10);
  const exp = $("#opnameExp");
  if (exp && !exp.value) exp.value = addDaysISO(30);
}

function renderOptions() {
  const options = state.items
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(item => `<option value="${item.id}">${escapeHtml(item.name)} (${escapeHtml(item.unit)})</option>`)
    .join("");
  ["#purchaseItem", "#usageItem", "#opnameItem"].forEach(selector => {
    const select = $(selector);
    if (!select) return;
    const current = select.value;
    select.innerHTML = options || `<option value="">Belum ada barang</option>`;
    if (state.items.some(item => item.id === current)) select.value = current;
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function emptyRow(colspan, text = "Belum ada data") {
  return `<tr><td class="empty-row" colspan="${colspan}">${text}</td></tr>`;
}

function renderDashboard() {
  const totalItems = state.items.length;
  const totalStock = state.items.reduce((sum, item) => sum + stockByItem(item.id), 0);
  const stockValue = state.items.reduce((sum, item) => sum + valueByItem(item.id), 0);
  const nearExp = state.lots.filter(lot => Number(lot.remainingQty) > 0 && daysUntil(lot.expDate) <= 7).length;

  $("#dashTotalItems").textContent = totalItems;
  $("#dashTotalStock").textContent = formatNumber(totalStock);
  $("#dashStockValue").textContent = formatCurrency(stockValue);
  $("#dashNearExp").textContent = nearExp;

  const expRows = state.lots
    .filter(lot => Number(lot.remainingQty) > 0)
    .sort((a, b) => String(a.expDate).localeCompare(String(b.expDate)))
    .slice(0, 8)
    .map(lot => {
      const status = expStatus(lot.expDate);
      return `<tr><td>${escapeHtml(itemName(lot.itemId))}</td><td>${formatNumber(lot.remainingQty)} ${escapeHtml(itemUnit(lot.itemId))}</td><td>${formatDate(lot.expDate)}</td><td><span class="badge ${status.className}">${status.label}</span></td></tr>`;
    }).join("");
  $("#dashExpTable").innerHTML = expRows || emptyRow(4, "Belum ada batch stok aktif");

  const lowRows = state.items
    .filter(item => stockByItem(item.id) < Number(item.minStock || 0))
    .map(item => `<tr><td>${item.id}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.category)}</td><td>${formatNumber(stockByItem(item.id))} ${escapeHtml(item.unit)}</td><td>${formatNumber(item.minStock)} ${escapeHtml(item.unit)}</td><td><span class="badge danger">Stok rendah</span></td></tr>`)
    .join("");
  $("#lowStockTable").innerHTML = lowRows || emptyRow(6, "Tidak ada bahan di bawah stok minimum");

  drawStockChart();
}

function drawStockChart() {
  const canvas = $("#stockChart");
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(640, Math.floor(rect.width * dpr));
  canvas.height = Math.floor(280 * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  ctx.clearRect(0, 0, width, height);
  ctx.font = "13px Arial";

  const data = state.items.map(item => ({ label: item.name, value: stockByItem(item.id), unit: item.unit })).sort((a, b) => b.value - a.value).slice(0, 8);
  if (!data.length) {
    ctx.fillStyle = "#64748b";
    ctx.fillText("Belum ada data stok", 24, 40);
    return;
  }

  const max = Math.max(...data.map(item => item.value), 1);
  const left = 150;
  const right = 35;
  const top = 18;
  const barH = 22;
  const gap = 11;
  const chartW = width - left - right;

  data.forEach((item, index) => {
    const y = top + index * (barH + gap);
    const barW = (item.value / max) * chartW;
    ctx.fillStyle = "#0d2f5b";
    ctx.fillText(trimLabel(item.label, 22), 12, y + 16);
    ctx.fillStyle = "#2d9ceb";
    ctx.fillRect(left, y, Math.max(2, barW), barH);
    ctx.fillStyle = "#111827";
    ctx.fillText(`${formatNumber(item.value)} ${item.unit}`, left + Math.max(8, barW) + 8, y + 16);
  });
}

function trimLabel(label, limit) {
  return label.length > limit ? `${label.slice(0, limit - 1)}…` : label;
}

function renderItems() {
  const keyword = ($("#itemSearch")?.value || "").toLowerCase();
  const rows = state.items
    .filter(item => `${item.id} ${item.name} ${item.category}`.toLowerCase().includes(keyword))
    .map(item => `<tr>
      <td>${item.id}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.category)}</td>
      <td>${escapeHtml(item.unit)}</td>
      <td>${formatNumber(item.minStock)}</td>
      <td>${formatNumber(stockByItem(item.id))} ${escapeHtml(item.unit)}</td>
      <td><button class="small-action edit" data-action="edit-item" data-id="${item.id}">Edit</button><button class="small-action delete" data-action="delete-item" data-id="${item.id}">Delete</button></td>
    </tr>`).join("");
  $("#itemsTable").innerHTML = rows || emptyRow(7);
}

function renderPurchases() {
  const keyword = ($("#purchaseSearch")?.value || "").toLowerCase();
  const rows = state.purchases
    .slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .filter(purchase => `${purchase.date} ${itemName(purchase.itemId)} ${purchase.supplier} ${purchase.note}`.toLowerCase().includes(keyword))
    .map(purchase => `<tr>
      <td>${formatDate(purchase.date)}</td>
      <td>${escapeHtml(itemName(purchase.itemId))}</td>
      <td>${formatNumber(purchase.qty)} ${escapeHtml(itemUnit(purchase.itemId))}</td>
      <td>${formatCurrency(purchase.unitPrice)}</td>
      <td>${formatCurrency(purchase.total)}</td>
      <td>${formatDate(purchase.expDate)}</td>
      <td>${escapeHtml(purchase.supplier || "-")}</td>
      <td><button class="small-action delete" data-action="delete-purchase" data-id="${purchase.id}">Delete</button></td>
    </tr>`).join("");
  $("#purchasesTable").innerHTML = rows || emptyRow(8);
}

function renderUsageLots() {
  const itemId = $("#usageItem")?.value;
  const rows = availableLots(itemId)
    .map(lot => {
      const status = expStatus(lot.expDate);
      return `<tr><td>${formatDate(lot.expDate)}</td><td>${formatNumber(lot.remainingQty)} ${escapeHtml(itemUnit(itemId))}</td><td>${formatCurrency(lot.unitPrice)}</td><td><span class="badge ${status.className}">${status.label}</span></td></tr>`;
    }).join("");
  $("#usageLotsTable").innerHTML = rows || emptyRow(4, "Tidak ada stok aktif untuk bahan ini");
}

function renderUsages() {
  const keyword = ($("#usageSearch")?.value || "").toLowerCase();
  const rows = state.usages
    .slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .filter(usage => `${usage.date} ${itemName(usage.itemId)} ${usage.note}`.toLowerCase().includes(keyword))
    .map(usage => {
      const batches = usage.usedLots.map(lot => `${formatDate(lot.expDate)}: ${formatNumber(lot.qty)} ${itemUnit(usage.itemId)}`).join("<br>");
      return `<tr>
        <td>${formatDate(usage.date)}</td>
        <td>${escapeHtml(itemName(usage.itemId))}</td>
        <td>${formatNumber(usage.qty)} ${escapeHtml(itemUnit(usage.itemId))}</td>
        <td>${batches || "-"}</td>
        <td>${escapeHtml(usage.note || "-")}</td>
        <td><button class="small-action delete" data-action="delete-usage" data-id="${usage.id}">Delete</button></td>
      </tr>`;
    }).join("");
  $("#usagesTable").innerHTML = rows || emptyRow(6);
}

function renderOpnameSystem() {
  const itemId = $("#opnameItem")?.value;
  const field = $("#opnameSystem");
  if (field) field.value = stockByItem(itemId);
}

function renderOpnames() {
  const keyword = ($("#opnameSearch")?.value || "").toLowerCase();
  const rows = state.opnames
    .slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .filter(opname => `${opname.date} ${itemName(opname.itemId)} ${opname.note}`.toLowerCase().includes(keyword))
    .map(opname => {
      const diffClass = opname.diff < 0 ? "danger" : opname.diff > 0 ? "neutral" : "ok";
      return `<tr>
        <td>${formatDate(opname.date)}</td>
        <td>${escapeHtml(itemName(opname.itemId))}</td>
        <td>${formatNumber(opname.systemQty)} ${escapeHtml(itemUnit(opname.itemId))}</td>
        <td>${formatNumber(opname.actualQty)} ${escapeHtml(itemUnit(opname.itemId))}</td>
        <td><span class="badge ${diffClass}">${formatNumber(opname.diff)}</span></td>
        <td>${escapeHtml(opname.note || "-")}</td>
        <td><button class="small-action delete" data-action="delete-opname" data-id="${opname.id}">Delete</button></td>
      </tr>`;
    }).join("");
  $("#opnameTable").innerHTML = rows || emptyRow(7);
}

function renderAll() {
  renderOptions();
  renderDashboard();
  renderItems();
  renderPurchases();
  renderUsageLots();
  renderUsages();
  renderOpnameSystem();
  renderOpnames();
  generateReport();
}

function handleItemForm(event) {
  event.preventDefault();
  const name = $("#itemName").value.trim();
  const category = $("#itemCategory").value.trim();
  const unit = $("#itemUnit").value;
  const minStock = Number($("#itemMinStock").value || 0);
  if (!name || !category || !unit) return showToast("Lengkapi data barang terlebih dahulu.");

  if (editingItemId) {
    const item = getItem(editingItemId);
    item.name = name;
    item.category = category;
    item.unit = unit;
    item.minStock = minStock;
    editingItemId = null;
    $("#itemForm button[type='submit']").textContent = "Simpan Barang";
    showToast("Data barang berhasil diperbarui.");
  } else {
    const nextNumber = state.items.length + 1;
    state.items.push({ id: `BRG-${String(nextNumber).padStart(3, "0")}-${Math.random().toString(36).slice(2,4).toUpperCase()}`, name, category, unit, minStock, createdAt: todayISO() });
    showToast("Barang baru berhasil ditambahkan.");
  }
  $("#itemForm").reset();
  $("#itemUnit").value = "kg";
  saveState();
  renderAll();
}

function handlePurchaseForm(event) {
  event.preventDefault();
  const date = $("#purchaseDate").value;
  const itemId = $("#purchaseItem").value;
  const qty = Number($("#purchaseQty").value);
  const unitPrice = Number($("#purchasePrice").value);
  const expDate = $("#purchaseExp").value;
  const supplier = $("#purchaseSupplier").value.trim();
  const note = $("#purchaseNote").value.trim();
  if (!itemId || !date || !qty || qty <= 0 || !expDate) return showToast("Lengkapi data pembelian dengan benar.");

  const purchase = { id: uid("PB"), date, itemId, qty, unitPrice, total: qty * unitPrice, expDate, supplier, note };
  const lot = { id: uid("LOT"), purchaseId: purchase.id, itemId, qty, remainingQty: qty, unitPrice, expDate, date, source: "pembelian" };
  state.purchases.push(purchase);
  state.lots.push(lot);
  saveState();
  event.target.reset();
  setDefaultDates();
  renderAll();
  showToast("Pembelian bahan berhasil disimpan.");
}

function handleUsageForm(event) {
  event.preventDefault();
  const date = $("#usageDate").value;
  const itemId = $("#usageItem").value;
  const qty = Number($("#usageQty").value);
  const note = $("#usageNote").value.trim();
  if (!itemId || !date || !qty || qty <= 0) return showToast("Lengkapi data pemakaian dengan benar.");

  try {
    const usedLots = reduceLots(itemId, qty);
    state.usages.push({ id: uid("PK"), date, itemId, qty, note, usedLots });
    saveState();
    event.target.reset();
    setDefaultDates();
    renderAll();
    showToast("Pemakaian bahan berhasil disimpan dengan metode FEFO.");
  } catch (err) {
    showToast(err.message);
  }
}

function handleOpnameForm(event) {
  event.preventDefault();
  const date = $("#opnameDate").value;
  const itemId = $("#opnameItem").value;
  const systemQty = Number($("#opnameSystem").value || 0);
  const actualQty = Number($("#opnameActual").value || 0);
  const note = $("#opnameNote").value.trim();
  const expDate = $("#opnameExp").value;
  if (!itemId || !date || actualQty < 0) return showToast("Lengkapi data stok opname dengan benar.");

  const diff = Number((actualQty - systemQty).toFixed(4));
  const opname = { id: uid("OP"), date, itemId, systemQty, actualQty, diff, note, addedLotId: null, adjustedLots: [] };

  try {
    if (diff > 0) {
      if (!expDate) return showToast("Isi tanggal expired untuk selisih stok lebih.");
      const lot = { id: uid("LOT-OP"), purchaseId: null, itemId, qty: diff, remainingQty: diff, unitPrice: averageCost(itemId), expDate, date, source: "opname" };
      state.lots.push(lot);
      opname.addedLotId = lot.id;
    } else if (diff < 0) {
      opname.adjustedLots = reduceLots(itemId, Math.abs(diff));
    }

    state.opnames.push(opname);
    saveState();
    event.target.reset();
    setDefaultDates();
    renderAll();
    showToast("Stok opname berhasil disimpan.");
  } catch (err) {
    showToast(err.message);
  }
}

function deleteItem(itemId) {
  const hasTransactions = state.purchases.some(p => p.itemId === itemId) || state.usages.some(u => u.itemId === itemId) || state.opnames.some(o => o.itemId === itemId) || state.lots.some(l => l.itemId === itemId && Number(l.remainingQty) > 0);
  if (hasTransactions) return showToast("Barang tidak dapat dihapus karena sudah memiliki transaksi atau stok aktif.");
  state.items = state.items.filter(item => item.id !== itemId);
  saveState();
  renderAll();
  showToast("Barang berhasil dihapus.");
}

function editItem(itemId) {
  const item = getItem(itemId);
  if (!item) return;
  editingItemId = itemId;
  $("#itemName").value = item.name;
  $("#itemCategory").value = item.category;
  $("#itemUnit").value = item.unit;
  $("#itemMinStock").value = item.minStock;
  $("#itemForm button[type='submit']").textContent = "Update Barang";
  showToast("Data barang siap diedit.");
}

function deletePurchase(purchaseId) {
  const lot = state.lots.find(item => item.purchaseId === purchaseId);
  if (lot && Number(lot.remainingQty) < Number(lot.qty)) return showToast("Pembelian tidak dapat dihapus karena batch sudah dipakai.");
  state.purchases = state.purchases.filter(purchase => purchase.id !== purchaseId);
  state.lots = state.lots.filter(item => item.purchaseId !== purchaseId);
  saveState();
  renderAll();
  showToast("Pembelian berhasil dihapus.");
}

function deleteUsage(usageId) {
  const usage = state.usages.find(item => item.id === usageId);
  if (!usage) return;
  restoreLots(usage.usedLots || []);
  state.usages = state.usages.filter(item => item.id !== usageId);
  saveState();
  renderAll();
  showToast("Pemakaian dihapus dan stok dikembalikan.");
}

function deleteOpname(opnameId) {
  const opname = state.opnames.find(item => item.id === opnameId);
  if (!opname) return;

  if (opname.diff > 0 && opname.addedLotId) {
    const lot = state.lots.find(item => item.id === opname.addedLotId);
    if (lot && Number(lot.remainingQty) < Number(lot.qty)) return showToast("Opname tidak dapat dihapus karena selisih stok sudah dipakai.");
    state.lots = state.lots.filter(item => item.id !== opname.addedLotId);
  }
  if (opname.diff < 0 && opname.adjustedLots) restoreLots(opname.adjustedLots);

  state.opnames = state.opnames.filter(item => item.id !== opnameId);
  saveState();
  renderAll();
  showToast("Catatan opname berhasil dihapus.");
}

function withinDate(value, start, end) {
  if (!value) return true;
  if (start && value < start) return false;
  if (end && value > end) return false;
  return true;
}

function generateReport() {
  const type = $("#reportType")?.value || "stock";
  const start = $("#reportStart")?.value || "";
  const end = $("#reportEnd")?.value || "";
  const titleMap = {
    stock: "Laporan Stok Saat Ini",
    purchases: "Laporan Pembelian Bahan",
    usages: "Laporan Pemakaian Bahan",
    opname: "Laporan Stok Opname",
    expiry: "Laporan Expired / Hampir Expired"
  };
  $("#reportMeta").textContent = `${titleMap[type]}${type === "stock" ? "" : ` | ${formatDate(start)} s.d. ${formatDate(end)}`}`;

  let headers = [];
  let rows = [];
  let footer = "";

  if (type === "stock") {
    headers = ["ID", "Bahan", "Kategori", "Satuan", "Stok", "Minimum", "Nilai Stok", "Status"];
    rows = state.items.map(item => {
      const stock = stockByItem(item.id);
      const value = valueByItem(item.id);
      return [item.id, item.name, item.category, item.unit, formatNumber(stock), formatNumber(item.minStock), formatCurrency(value), stock < item.minStock ? "Stok rendah" : "Aman"];
    });
    footer = `<tr><th colspan="6">Total Nilai Stok</th><th colspan="2">${formatCurrency(state.items.reduce((sum, item) => sum + valueByItem(item.id), 0))}</th></tr>`;
  }

  if (type === "purchases") {
    headers = ["Tanggal", "Bahan", "Jumlah", "Harga Satuan", "Total", "Expired", "Supplier", "Keterangan"];
    rows = state.purchases
      .filter(item => withinDate(item.date, start, end))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map(p => [formatDate(p.date), itemName(p.itemId), `${formatNumber(p.qty)} ${itemUnit(p.itemId)}`, formatCurrency(p.unitPrice), formatCurrency(p.total), formatDate(p.expDate), p.supplier || "-", p.note || "-"]);
    const total = state.purchases.filter(item => withinDate(item.date, start, end)).reduce((sum, p) => sum + Number(p.total || 0), 0);
    footer = `<tr><th colspan="4">Total Pembelian</th><th colspan="4">${formatCurrency(total)}</th></tr>`;
  }

  if (type === "usages") {
    headers = ["Tanggal", "Bahan", "Jumlah", "Batch Exp", "Keterangan"];
    rows = state.usages
      .filter(item => withinDate(item.date, start, end))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map(u => [formatDate(u.date), itemName(u.itemId), `${formatNumber(u.qty)} ${itemUnit(u.itemId)}`, (u.usedLots || []).map(lot => `${formatDate(lot.expDate)} (${formatNumber(lot.qty)})`).join("; ") || "-", u.note || "-"]);
  }

  if (type === "opname") {
    headers = ["Tanggal", "Bahan", "Stok Sistem", "Stok Fisik", "Selisih", "Catatan"];
    rows = state.opnames
      .filter(item => withinDate(item.date, start, end))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map(o => [formatDate(o.date), itemName(o.itemId), `${formatNumber(o.systemQty)} ${itemUnit(o.itemId)}`, `${formatNumber(o.actualQty)} ${itemUnit(o.itemId)}`, formatNumber(o.diff), o.note || "-"]);
  }

  if (type === "expiry") {
    headers = ["Bahan", "Sisa Stok", "Tanggal Expired", "Sisa Hari", "Harga", "Status"];
    rows = state.lots
      .filter(lot => Number(lot.remainingQty) > 0 && daysUntil(lot.expDate) <= 14)
      .sort((a, b) => String(a.expDate).localeCompare(String(b.expDate)))
      .map(lot => {
        const status = expStatus(lot.expDate);
        return [itemName(lot.itemId), `${formatNumber(lot.remainingQty)} ${itemUnit(lot.itemId)}`, formatDate(lot.expDate), String(daysUntil(lot.expDate)), formatCurrency(lot.unitPrice), status.label];
      });
  }

  currentReportHeaders = headers;
  currentReportRows = rows;
  const thead = $("#reportTable thead");
  const tbody = $("#reportTable tbody");
  const tfoot = $("#reportTable tfoot");
  thead.innerHTML = `<tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join("")}</tr>`;
  tbody.innerHTML = rows.length ? rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("") : emptyRow(headers.length, "Tidak ada data untuk laporan ini");
  tfoot.innerHTML = footer;
}

function exportCsv() {
  if (!currentReportHeaders.length) generateReport();
  const lines = [currentReportHeaders, ...currentReportRows].map(row => row.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `laporan-inventory-sppg-baleendah-12-${todayISO()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function bindEvents() {
  $$(".menu-item").forEach(button => {
    button.addEventListener("click", () => {
      const page = button.dataset.page;
      $$(".menu-item").forEach(item => item.classList.remove("active"));
      button.classList.add("active");
      $$(".page").forEach(item => item.classList.remove("active"));
      $(`#page-${page}`).classList.add("active");
      $("#pageTitle").textContent = button.textContent;
      if (page === "laporan") generateReport();
      if (page === "dashboard") drawStockChart();
    });
  });

  $("#itemForm").addEventListener("submit", handleItemForm);
  $("#purchaseForm").addEventListener("submit", handlePurchaseForm);
  $("#usageForm").addEventListener("submit", handleUsageForm);
  $("#opnameForm").addEventListener("submit", handleOpnameForm);

  ["#itemSearch", "#purchaseSearch", "#usageSearch", "#opnameSearch"].forEach(selector => {
    const field = $(selector);
    if (!field) return;
    field.addEventListener("input", renderAll);
  });

  $("#usageItem").addEventListener("change", renderUsageLots);
  $("#opnameItem").addEventListener("change", renderOpnameSystem);
  $("#generateReportBtn").addEventListener("click", generateReport);
  $("#printReportBtn").addEventListener("click", () => { generateReport(); window.print(); });
  $("#exportCsvBtn").addEventListener("click", exportCsv);
  $("#reportType").addEventListener("change", generateReport);
  $("#reportStart").addEventListener("change", generateReport);
  $("#reportEnd").addEventListener("change", generateReport);

  document.body.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === "edit-item") return editItem(id);
    if (!confirm("Yakin ingin menghapus data ini?")) return;
    if (action === "delete-item") deleteItem(id);
    if (action === "delete-purchase") deletePurchase(id);
    if (action === "delete-usage") deleteUsage(id);
    if (action === "delete-opname") deleteOpname(id);
  });

  $("#resetDemoBtn").addEventListener("click", () => {
    if (!confirm("Reset semua data dan kembalikan ke data demo?")) return;
    state = getSeedData();
    editingItemId = null;
    saveState();
    setDefaultDates();
    renderAll();
    showToast("Data demo berhasil dipulihkan.");
  });

  $("#logoutBtn").addEventListener("click", () => showToast("Mode demo: fitur login belum diaktifkan."));
  window.addEventListener("resize", () => drawStockChart());
}

function init() {
  $("#todayLabel").textContent = new Date().toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  setDefaultDates();
  bindEvents();
  renderAll();
  initOnlineDatabase();
}

init();
