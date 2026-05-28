/**
 * js/app.js - Shri Parshwanatha Rice Mill (Enterprise Edition)
 * Master Consolidated Application Interface Script
 */
// TEMPORARY MOBILE DIAGNOSTIC TOAST
window.onerror = function(message, source, lineno, colno, error) {
    alert("❌ CRITICAL APP ERROR:\n" + message + "\nLine: " + lineno);
    return false;
};

if (typeof db === 'undefined') {
    alert("🚨 DATABASE ERROR: The 'db' variable is missing! Check your script tags.");
}

let expenseChartInstance = null;
let stockChartInstance = null;

// --- 1. CORE SYSTEM REFRESH LOGIC ---
window.refreshAll = async () => {
    try {
        await viewDayLog();
        await generateSummary();
        await refreshSettingsList();
        if (typeof toggleExpenseInputs === 'function') {
            await toggleExpenseInputs();
        }
    } catch (e) {
        console.error("Refresh Performance Error:", e);
    }
};

// --- 2. DYNAMIC TAB CONTAINER ROUTING SWITCHER ---
const switchTab = (tabId) => {
    document.querySelectorAll('.tab-content').forEach(c => {
        c.classList.remove('active');
        c.style.display = "none";
    });
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    const target = document.getElementById(tabId);
    const nav = document.querySelector(`[data-tab="${tabId}"]`);

    if (target) {
        target.classList.add('active');
        target.style.display = "block";
    }
    if (nav) nav.classList.add('active');

    if (['dashboard-tab', 'history-tab', 'stock-tab', 'settings-tab', 'expenses-tab'].includes(tabId)) {
        window.refreshAll();
    }
};

// --- 3. HARDWARE RUNTIME INITIALIZATION BLOCK ---
window.onload = async () => {
    const today = new Date().toISOString().split('T')[0];
    const datePicker = document.getElementById('main_date_picker');
    if (datePicker) {
        datePicker.value = today;
        datePicker.onchange = window.refreshAll;
    }

    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.onclick = () => switchTab(btn.getAttribute('data-tab'));
    });

    const bindAction = (id, targetFunction) => {
        const component = document.getElementById(id);
        if (component) component.onclick = targetFunction;
    };

    bindAction('btn_save_hulling', saveHulling);
    bindAction('btn_save_stock', saveStock);
    bindAction('btn_save_expense', saveExpense);
    bindAction('btn_add_variety', addNewVariety);
    bindAction('btn_backup', exportData);
    
    bindAction('btn_export_daily_pdf', exportDailyPDF);
    bindAction('btn_export_daily_excel', exportDailyExcel);
    
    bindAction('btn_master_reset', async () => {
        if (confirm("🚨 DANGER: This will permanently wipe your database! Proceed?")) {
            await db.delete();
            location.reload();
        }
    });

    const systemRestoreBtn = document.getElementById('btn_restore_trigger');
    const systemFileInput = document.getElementById('import_file');

    if (systemRestoreBtn && systemFileInput) {
        systemRestoreBtn.onclick = () => systemFileInput.click();
        systemFileInput.onchange = (e) => importData(e);
    }

    const expCatSelector = document.getElementById('exp_type_cat');
    if (expCatSelector) {
        expCatSelector.onchange = toggleExpenseInputs;
    }

    setupAutoCalculations();
    
    // Crucial: Runs immediately on startup so the dropdown list populates straight away
    await loadDropdowns(); 
    
    switchTab('hulling-tab');
    window.refreshAll();
};

// --- 4. MATHEMATICAL FORMULATION INTERFACES ---
function setupAutoCalculations() {
    // A. Hulling Service Calculations
    const hWeight = document.getElementById('h_weight');
    const hRate = document.getElementById('h_rate');
    const hTotal = document.getElementById('h_total_input');

    const runHullingCalc = () => {
        if (document.activeElement !== hTotal) {
            const weightVal = parseFloat(hWeight.value) || 0;
            const rate = parseFloat(hRate.value) || 0;
            hTotal.value = Math.round(weightVal * rate);
        }
    };

    if (hWeight && hRate) {
        hWeight.oninput = runHullingCalc;
        hRate.oninput = runHullingCalc;
    }

    // B. Inventory Calculations
    const stWeight = document.getElementById('st_weight');
    const stRate = document.getElementById('st_rate');
    const stAmount = document.getElementById('st_amount');
    const stBags = document.getElementById('st_bags');
    const stBagWeight = document.getElementById('st_bag_weight');

    const runStockCalc = () => {
        if (!stWeight || !stRate || !stAmount) return;

        const bags = parseFloat(stBags?.value) || 0;
        const bagWeight = parseFloat(stBagWeight?.value) || 0;
        const weight = parseFloat(stWeight.value) || 0;
        const rate = parseFloat(stRate.value) || 0;
        let total = 0;

        if (bags > 0 && bagWeight > 0) {
            const calculatedTotalKg = bags * bagWeight;
            stWeight.value = calculatedTotalKg;
            total = calculatedTotalKg * rate;
        } else {
            total = weight * rate;
        }
        stAmount.value = Math.round(total);
    };

    if (stWeight && stRate) {
        stWeight.oninput = runStockCalc;
        stRate.oninput = runStockCalc;
    }
    if (stBags && stBagWeight) {
        stBags.oninput = runStockCalc;
        stBagWeight.oninput = runStockCalc;
    }

    // C. Labor Wages Calculation
    const expLaborWeight = document.getElementById('exp_labor_weight');
    const expLaborRate = document.getElementById('exp_labor_rate');
    const expAmount = document.getElementById('exp_amount');

    if (expLaborWeight && expLaborRate && expAmount) {
        const runExpenseLaborCalc = () => {
            const weight = parseFloat(expLaborWeight.value) || 0;
            const rate = parseFloat(expLaborRate.value) || 0;
            expAmount.value = Math.round(weight * rate);
        };
        expLaborRate.oninput = runExpenseLaborCalc;
    }
}

// --- 5. DYNAMIC UI DROPDOWN MANAGEMENT ---
async function toggleExpenseInputs() {
    const category = document.getElementById('exp_type_cat')?.value;
    const laborCalcRow = document.getElementById('row_bill_labor_calc');
    const expAmountField = document.getElementById('exp_amount');
    const expWeightField = document.getElementById('exp_labor_weight');

    if (!laborCalcRow || !expAmountField) return;

    if (category === "Wages") {
        laborCalcRow.style.display = "block";
        expAmountField.readOnly = true;

        const selectedDate = document.getElementById('main_date_picker').value;
        const currentDayHulling = await db.hulling.where('date').equals(selectedDate).toArray();
        const totalHullingWeight = currentDayHulling.reduce((sum, h) => sum + (parseFloat(h.weight) || 0), 0);
        
        if (expWeightField) {
            expWeightField.value = totalHullingWeight;
        }
    } else {
        laborCalcRow.style.display = "none";
        expAmountField.readOnly = false;
    }
}

function getUnitLabel(type = "") {
    type = type.toLowerCase();
    if (type.includes("white") || type.includes("red")) return "Q";
    if (type.includes("husk")) return "KG";
    if (type.includes("diesel")) return "Ltr";
    if (type.includes("salt")) return "Bag";
    if (type.includes("empty bag")) return "Nos";
    return "KG";
}

async function loadDropdowns() {
    const action = document.getElementById('st_action').value;
    const stockSelect = document.getElementById('st_type');
    if (!stockSelect) return;
    
    stockSelect.innerHTML = ""; 

    try {
        const allSettings = await db.settings.toArray();

        if (action === "Purchase") {
            const paddyItems = allSettings.filter(item => item.category === "paddy");
            if (paddyItems.length === 0) {
                stockSelect.add(new Option("⚠️ No Paddy Varieties Found", ""));
            }
            paddyItems.forEach(item => {
                const itemName = item.fullName || item.name;
                stockSelect.add(new Option(`🌾 ${itemName} (New)`, `${itemName} (New)`));
                stockSelect.add(new Option(`🌾 ${itemName} (Old)`, `${itemName} (Old)`));
            });

        } else if (action === "Sale") {
            const riceItems = allSettings.filter(item => item.category === "rice");
            if (riceItems.length === 0) {
                stockSelect.add(new Option("⚠️ No Rice Varieties Found", ""));
            }
            riceItems.forEach(item => {
                const itemName = item.fullName || item.name;
                stockSelect.add(new Option(`🍚 ${itemName}`, itemName));
            });

        } else if (action === "Misc") {
            const miscItems = allSettings.filter(item => item.category === "misc");
            if (miscItems.length === 0) {
                stockSelect.add(new Option("📦 Husk Waste", "Husk Waste"));
                stockSelect.add(new Option("📦 Broken Rice", "Broken Rice"));
            } else {
                miscItems.forEach(item => {
                    const itemName = item.fullName || item.name;
                    stockSelect.add(new Option(`📦 ${itemName}`, itemName));
                });
            }
        }
    } catch (err) {
        console.error("Error populating stock dropdown menus:", err);
    }
}

async function refreshSettingsList() {
    const list = document.getElementById('settings_grid');
    if (!list) return;
    const data = await db.settings.toArray();
    list.innerHTML = "<h3 style='margin-top:0;'>Saved System Configurations</h3>";
    data.forEach(item => {
        list.innerHTML += `
            <div class="item-row" style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #eee;">
                <span><b>${item.category.toUpperCase()}:</b> ${item.fullName || item.name}</span>
                <button class="btn-sm" style="background:#d32f2f; color:white; border:none; padding:3px 8px; border-radius:4px; cursor:pointer;" onclick="deleteVariety(${item.id})">Delete</button>
            </div>`;
    });
    await loadDropdowns();
}

async function addNewVariety() {
    const name = document.getElementById('new_item_val').value.trim();
    const cat = document.getElementById('new_item_cat').value;
    if (!name) return alert("Please enter a classification label.");
    await db.settings.add({ fullName: name, category: cat });
    document.getElementById('new_item_val').value = "";
    window.refreshAll();
}

async function deleteVariety(id) {
    if (confirm("Delete this setup item?")) {
        await db.settings.delete(id);
        window.refreshAll();
    }
}

// --- 6. METRICS ACCOUNT BALANCES CALCULATOR ---
async function generateSummary() {
    try {
        const stockEntries = await db.stock.toArray();
        const hullingEntries = await db.hulling.toArray();
        const settingsEntries = await db.settings.toArray();
        let expenseEntries = [];
        if (db.expenses) expenseEntries = await db.expenses.toArray();

        let totalRevenue = 0;
        let totalExpenses = 0;

        let costCategories = { paddy_purchases: 0, labor_wages: 0, electricity: 0, diesel: 0, miscellaneous: 0 };
        let stockInventory = {};
        const categoryMap = {};

        settingsEntries.forEach(s => {
            const nameKey = (s.fullName || s.name || "").toLowerCase().trim();
            if (nameKey) categoryMap[nameKey] = (s.category || "").toLowerCase().trim();
        });

        hullingEntries.forEach(h => { totalRevenue += parseFloat(h.total) || 0; });

        stockEntries.forEach(item => {
            const amt = parseFloat(item.amount) || 0;
            const weight = parseFloat(item.weight) || 0;
            const itemTypeRaw = (item.type || "").trim();
            const itemTypeLower = itemTypeRaw.toLowerCase();

            if (item.action === "Sale") {
                totalRevenue += amt;
            } else if (item.action === "Purchase") {
                totalExpenses += amt;
                costCategories.paddy_purchases += amt;
            }

            if (itemTypeRaw) {
                if (!stockInventory[itemTypeRaw]) stockInventory[itemTypeRaw] = 0;
                if (itemTypeLower.includes("husk") || itemTypeLower.includes("waste") || itemTypeLower.includes("rice")) {
                    stockInventory[itemTypeRaw] += (item.action === "Sale") ? weight : -weight;
                } else {
                    stockInventory[itemTypeRaw] += (item.action === "Purchase") ? weight : -weight;
                }
            }
        });

        expenseEntries.forEach(exp => {
            const amt = parseFloat(exp.amount) || 0;
            totalExpenses += amt;
            const expCat = (exp.category || "").toLowerCase();
            const expName = (exp.name || "").toLowerCase();

            if (expCat === "wages" || expName.includes("labour") || expName.includes("wage")) costCategories.labor_wages += amt;
            else if (expCat === "electricity" || expName.includes("electricity") || expName.includes("power") || expName.includes("mescom")) costCategories.electricity += amt;
            else if (expCat === "fuel" || expName.includes("diesel")) costCategories.diesel += amt;
            else costCategories.miscellaneous += amt;
        });

        const netProfit = totalRevenue - totalExpenses;

        if (document.getElementById('dash_total_revenue')) document.getElementById('dash_total_revenue').innerText = "₹" + Math.round(totalRevenue).toLocaleString('en-IN');
        if (document.getElementById('dash_total_costs')) document.getElementById('dash_total_costs').innerText = "₹" + Math.round(totalExpenses).toLocaleString('en-IN');
        if (document.getElementById('dash_net_profit')) {
            const el = document.getElementById('dash_net_profit');
            el.innerText = "₹" + Math.round(netProfit).toLocaleString('en-IN');
            el.style.color = netProfit >= 0 ? "#2e7d32" : "#c62828";
        }

        renderExpensePieChart(costCategories);
        renderStockBarChart(stockInventory, categoryMap);
        
        if(document.getElementById('summary_display')) renderInventoryTable(stockInventory, 'summary_display');
        if(document.getElementById('summary_display_history')) renderInventoryTable(stockInventory, 'summary_display_history');

    } catch (err) {
        console.error("Summary Matrix Computation Failure:", err);
    }
}

// --- 7. CHART RENDERING FLOWS ---
function renderExpensePieChart(costs) {
    const canvas = document.getElementById('expenseChart');
    if (!canvas) return;
    if (expenseChartInstance) { expenseChartInstance.destroy(); expenseChartInstance = null; }

    const ctx = canvas.getContext('2d');
    expenseChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Paddy Purchases', 'Labour Wages', 'Electricity', 'Diesel Fuel', 'Other Outlays'],
            datasets: [{
                data: [costs.paddy_purchases, costs.labor_wages, costs.electricity, costs.diesel, costs.miscellaneous],
                backgroundColor: ['#512da8', '#f57c00', '#0288d1', '#d81b60', '#78909c'],
                borderColor: '#ffffff',
                borderWidth: 2
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } } }
    });
}

function renderStockBarChart(inventory, categoryMap) {
    const canvas = document.getElementById('stockBarChart');
    if (!canvas) return;
    if (stockChartInstance) { stockChartInstance.destroy(); stockChartInstance = null; }

    const labels = Object.keys(inventory);
    const dataValues = Object.values(inventory);
    if (labels.length === 0) { const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); return; }

    const backgroundColors = labels.map(label => {
        const lowerLabel = label.toLowerCase();
        let cat = "paddy";
        for (const [key, val] of Object.entries(categoryMap)) { if (lowerLabel.includes(key)) { cat = val; break; } }
        if (cat === "rice" || lowerLabel.includes("rice")) return '#2e7d32';
        if (lowerLabel.includes("husk") || lowerLabel.includes("waste")) return '#b0bec5';
        return '#ffb300';
    });

    const ctx = canvas.getContext('2d');
    stockChartInstance = new Chart(ctx, {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: 'Stock Balance', data: dataValues, backgroundColor: backgroundColors, borderRadius: 4 }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true }, x: { ticks: { maxRotation: 45, minRotation: 45, font: { size: 9 } } } },
            plugins: { legend: { display: false } }
        }
    });
}

function renderInventoryTable(stockInventory, elementId) {
    const target = document.getElementById(elementId);
    if (!target) return;

    let html = `
        <table class="summary-table" style="width:100%; border-collapse:collapse; text-align:left; font-size:13px;">
            <thead>
                <tr style="background-color:#eff1f5; border-bottom:2px solid #cfd8dc;">
                    <th style="padding:10px;">Commodity Reference</th>
                    <th style="padding:10px; text-align:right;">Book Balance</th>
                </tr>
            </thead>
            <tbody>`;

    const keys = Object.keys(stockInventory);
    if (keys.length === 0) {
        html += `<tr><td colspan="2" style="text-align:center; padding:15px; color:#999;">No warehouse logs found.</td></tr>`;
    } else {
        keys.forEach((k, idx) => {
            const unit = (k.toLowerCase().includes("husk") || k.toLowerCase().includes("rice")) ? "KG" : "Q";
            html += `
                <tr style="background-color:${idx % 2 === 0 ? '#ffffff' : '#f9f9f9'}; border-bottom:1px solid #eee;">
                    <td style="padding:8px 10px;">${k}</td>
                    <td style="padding:8px 10px; text-align:right; font-weight:bold; color:${stockInventory[k] >= 0 ? '#2e7d32' : '#c62828'}">
                        ${stockInventory[k].toFixed(2)} ${unit}
                    </td>
                </tr>`;
        });
    }
    target.innerHTML = html + `</tbody></table>`;
}

// --- 8. DATA LEDGER WRITING OPERATIONS ---
async function saveHulling() {
    await db.hulling.add({
        name: document.getElementById('h_name').value.trim(),
        weight: parseFloat(document.getElementById('h_weight').value) || 0,
        rate: parseFloat(document.getElementById('h_rate').value) || 0,
        total: parseFloat(document.getElementById('h_total_input').value) || 0,
        status: document.getElementById('h_status').value,
        date: document.getElementById('main_date_picker').value
    });
    showToast("Hulling Record Logged!");
    document.getElementById('h_name').value = "";
    document.getElementById('h_weight').value = "";
    document.getElementById('h_total_input').value = "";
    window.refreshAll();
}

async function saveStock() {
    const itemType = document.getElementById('st_type').value;
    await db.stock.add({
        name: document.getElementById('st_name').value.trim(),
        action: document.getElementById('st_action').value,
        type: itemType,
        weight: parseFloat(document.getElementById('st_weight').value) || 0,
        bags: parseFloat(document.getElementById('st_bags').value) || 0,
        bagWeight: parseFloat(document.getElementById('st_bag_weight').value) || 0,
        rate: parseFloat(document.getElementById('st_rate').value) || 0,
        amount: parseFloat(document.getElementById('st_amount').value) || 0,
        unit: getUnitLabel(itemType),
        date: document.getElementById('main_date_picker').value
    });
    showToast("Stock Entry Saved!");
    document.getElementById('st_name').value = "";
    document.getElementById('st_weight').value = "";
    document.getElementById('st_bags').value = "";
    document.getElementById('st_bag_weight').value = "";
    document.getElementById('st_rate').value = "";
    document.getElementById('st_amount').value = "";
    window.refreshAll();
}

async function saveExpense() {
    const category = document.getElementById('exp_type_cat').value;
    const amount = parseFloat(document.getElementById('exp_amount').value) || 0;
    let details = document.getElementById('exp_name').value.trim();
    
    if (category === "Wages") {
        const rate = document.getElementById('exp_labor_rate').value || 0;
        const weight = document.getElementById('exp_labor_weight').value || 0;
        details = `${details} (Labor Payout: ${weight}Q @ ₹${rate}/Q)`.trim();
    } else if (category === "Electricity" && !details) {
        details = "MESCOM Electricity Bill Payout";
    }

    if (amount <= 0) return alert("Please enter a valid expense amount.");

    await db.expenses.add({
        category: category,
        name: details,
        amount: amount,
        date: document.getElementById('main_date_picker').value
    });

    showToast("Expense Recorded Successfully!");
    document.getElementById('exp_name').value = "";
    document.getElementById('exp_amount').value = "";
    if (document.getElementById('exp_labor_rate')) document.getElementById('exp_labor_rate').value = "";
    
    window.refreshAll();
}

async function viewDayLog() {
    const d = document.getElementById('main_date_picker').value;
    const hulling = await db.hulling.where('date').equals(d).toArray();
    const stock = await db.stock.where('date').equals(d).toArray();
    let expenses = [];
    if (db.expenses) expenses = await db.expenses.where('date').equals(d).toArray();
    
    let html = "";

    const combinedLogs = [
        ...hulling.map(v => ({ ...v, table: 'hulling' })),
        ...stock.map(v => ({ ...v, table: 'stock' })),
        ...expenses.map(v => ({ ...v, table: 'expenses' }))
    ];

    combinedLogs.forEach(x => {
        let isLabor = x.table === 'expenses' && (x.category === 'Wages' || (x.name || "").toLowerCase().includes("labor"));
        let typeLabel = x.table === 'hulling' ? 'Hulling Service' : (x.table === 'expenses' ? `Expense: ${x.category}` : x.type);
        let qtyText = x.table === 'hulling' ? `${x.weight} Q` : (x.table === 'expenses' ? 'Financial Outflow' : `${x.weight} ${x.unit || 'KG'}`);
        
        if (isLabor && x.name.includes("Payout:")) {
            qtyText = "Calculated Wage Payment";
        }

        let borderColors = '#ff9800';
        if (x.table === 'hulling') borderColors = '#673ab7';
        else if (x.table === 'expenses') borderColors = isLabor ? '#00b0ff' : '#d32f2f';

        html += `
        <div class="log-card" style="border-left: 6px solid ${borderColors}; padding:10px; margin-bottom:8px; display:flex; justify-content:space-between; background:#fff; border-radius:4px; box-shadow:0 1px 3px rgba(0,0,0,0.05); align-items:center;">
            <div><b>${x.name || 'Counter Transaction'}</b> (${typeLabel})<br><small>${qtyText} | Total: ₹${x.total || x.amount}</small></div>
            <div style="display:flex; gap:5px;">
                <button class="btn-sm" style="padding:4px 8px; cursor:pointer;" onclick="generateBillPDF('${x.id}', '${x.table}')">PDF</button>
                <button class="btn-sm" style="background:#c62828; color:#fff; border:none; border-radius:3px; padding:4px 8px; cursor:pointer;" onclick="deleteEntry('${x.id}', '${x.table}')">Del</button>
            </div>
        </div>`;
    });
    document.getElementById('day_log').innerHTML = html || "No records logged for today.";
}

async function generateBillPDF(id, table) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const data = await db[table].get(Number(id));
    if (!data) return alert("Record fetch missing.");

    doc.setFontSize(18);
    doc.text("SHRI PARSHWANATHA RICE MILL", 105, 15, { align: "center" });
    doc.setFontSize(10);
    doc.text("Proprietor: Jwalaprasad K J | Sullalli, Shimoga", 105, 22, { align: "center" });
    doc.text("Date: " + data.date, 105, 27, { align: "center" });
    doc.line(20, 30, 190, 30);
    
    let descriptiveTitle = data.name || "Walk-in Transaction";
    doc.text("Account Name Reference: " + descriptiveTitle, 20, 38);

    let rows = [];
    if (table === 'hulling') {
        rows.push(["Hulling Production Fee", `${data.weight} Q`, `Rs. ${data.rate}`, `Rs. ${data.total}`]);
    } else if (table === 'expenses') {
        rows.push([`Expense entry (${data.category})`, "N/A", "Ledger Outflow", `Rs. ${data.amount}`]);
    } else {
        rows.push([data.type, data.bags ? `${data.bags} Bags x ${data.bagWeight}kg` : `${data.weight} ${data.unit}`, `Rs. ${data.rate}`, `Rs. ${data.amount}`]);
    }

    doc.autoTable({
        startY: 45,
        head: [['Item Specifications', 'Calculated Weight', 'Unit Rate Base', 'Net Amount']],
        body: rows,
        theme: 'grid',
        headStyles: { fillColor: [81, 45, 168] }
    });

    doc.save(`${data.name || 'Receipt'}_Statement.pdf`);
}

// --- 9. STABLE EXPORT ENGINE PIPELINES ---
async function exportDailyPDF() {
    const targetDate = document.getElementById('main_date_picker').value;
    const hulling = await db.hulling.where('date').equals(targetDate).toArray();
    const stock = await db.stock.where('date').equals(targetDate).toArray();
    let expenses = [];
    if (db.expenses) expenses = await db.expenses.where('date').equals(targetDate).toArray();
    
    if (hulling.length === 0 && stock.length === 0 && expenses.length === 0) {
        return alert("No data logs recorded to export for this date.");
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFontSize(16);
    doc.text("DAILY TRANSACTION SUMMARY REPORT", 105, 15, { align: "center" });
    doc.setFontSize(11);
    doc.text(`Shri Parshwanatha Rice Mill | Statement Date: ${targetDate}`, 105, 22, { align: "center" });
    doc.line(15, 26, 195, 26);

    let bodyRows = [];
    hulling.forEach(h => {
        bodyRows.push(["Hulling Production", h.name || "-", `${h.weight} Q`, `₹${h.rate}`, `₹${h.total}`]);
    });
    stock.forEach(s => {
        let qty = s.bags ? `${s.bags} Bags × ${s.bagWeight}KG` : `${s.weight} ${s.unit || 'KG'}`;
        bodyRows.push([s.action + " - " + s.type, s.name || "-", qty, `₹${s.rate}`, `₹${s.amount}`]);
    });
    expenses.forEach(e => {
        bodyRows.push([`Expense - ${e.category}`, e.name || "-", "Outflow", "-", `₹${e.amount}`]);
    });

    doc.autoTable({
        startY: 32,
        head: [['Transaction Category', 'Party Name', 'Quantity/Weight', 'Rate Base', 'Total Net Amount']],
        body: bodyRows,
        theme: 'striped',
        headStyles: { fillColor: [46, 125, 50] }
    });

    doc.save(`Daily_Report_${targetDate}.pdf`);
}

async function exportDailyExcel() {
    const targetDate = document.getElementById('main_date_picker').value;
    const hulling = await db.hulling.where('date').equals(targetDate).toArray();
    const stock = await db.stock.where('date').equals(targetDate).toArray();
    let expenses = [];
    if (db.expenses) expenses = await db.expenses.where('date').equals(targetDate).toArray();

    if (hulling.length === 0 && stock.length === 0 && expenses.length === 0) {
        return alert("No data logs recorded to export for this date.");
    }

    let csvRows = ["Transaction Category,Party Name,Quantity/Weight,Rate Base,Total Net Amount"];

    hulling.forEach(h => {
        csvRows.push(`"Hulling Production","${h.name || '-'}","${h.weight} Q","${h.rate}","${h.total}"`);
    });
    stock.forEach(s => {
        let qty = s.bags ? `${s.bags} Bags x ${s.bagWeight}KG` : `${s.weight} ${s.unit || 'KG'}`;
        csvRows.push(`"${s.action} - ${s.type}","${s.name || '-'}","${qty}","${s.rate}","${s.amount}"`);
    });
    expenses.forEach(e => {
        csvRows.push(`"Expense - ${e.category}","${e.name || '-'}","Financial Outflow","-","${e.amount}"`);
    });

    const csvContent = csvRows.join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const blobUrl = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.setAttribute("href", blobUrl);
    link.setAttribute("download", `Daily_Report_${targetDate}.csv`);
    document.body.appendChild(link);
    
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl); 
}

async function deleteEntry(id, table) {
    if (confirm("Permanently erase record?")) {
        await db[table].delete(Number(id));
        window.refreshAll();
    }
}

// --- 10. BACKUP AND IMPORT PROTOCOLS ---
async function importData(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (confirm("WARNING: Overwrite operational records with this backup file?")) {
                await Promise.all([db.settings.clear(), db.hulling.clear(), db.stock.clear()]);
                if (db.expenses) await db.expenses.clear();

                if (data.settings) await db.settings.bulkPut(data.settings);
                if (data.hulling) await db.hulling.bulkPut(data.hulling);
                if (data.stock) await db.stock.bulkPut(data.stock);
                if (data.expenses && db.expenses) await db.expenses.bulkPut(data.expenses);

                alert("Database Restored Successfully!");
                location.reload(); 
            }
        } catch (err) {
            alert("JSON Processing Crash: " + err.message);
        }
    };
    reader.readAsText(file);
}

async function exportData() {
    const settings = await db.settings.toArray();
    const hulling = await db.hulling.toArray();
    const stock = await db.stock.toArray();
    const payload = { settings, hulling, stock };
    if (db.expenses) payload.expenses = await db.expenses.toArray();

    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Backup_Mill_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
}

function showToast(text) {
    const t = document.getElementById('toast');
    if (t) { t.innerText = text; t.className = "show"; setTimeout(() => t.className = "", 3000); }
}
