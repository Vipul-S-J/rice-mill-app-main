/**
 * js/db.js - Shri Parshwanatha Rice Mill (Enterprise Edition)
 * Database Configuration & Initialization Script
 */

// 1. Initialize Dexie Database Instance
const db = new Dexie("ShriParshwanathaRiceMillDB");

// 2. Define Schema Version and Table Indexes 
// Note: Indexes correspond exactly to fields used in .where() and .equals() queries in app.js
db.version(1).stores({
    settings: '++id, name, fullName, category',
    hulling: '++id, name, weight, rate, total, status, date',
    stock: '++id, name, action, type, weight, bags, bagWeight, rate, amount, unit, date',
    expenses: '++id, category, name, amount, date'
});

// 3. Open Database Connection Safely
db.open().catch(function (err) {
    console.error("Failed to open IndexedDB via Dexie: ", err.stack || err);
});
