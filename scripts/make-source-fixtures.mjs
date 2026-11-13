#!/usr/bin/env node
/**
 * Sprint 13: write CSV and XLSX versions of the fictional CRM dataset
 * (src/examples/crm/source-records.json). Every value is written as text so
 * all three formats normalize to identical records. Fictional data only.
 *
 *   node scripts/make-source-fixtures.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import Papa from "papaparse";
import * as XLSX from "xlsx";

const source = JSON.parse(readFileSync("src/examples/crm/source-records.json", "utf8"));
const columns = [...new Set(source.records.flatMap((record) => Object.keys(record)))];
const rows = source.records.map((record) => columns.map((column) => (column in record ? record[column] : "")));

const csv = Papa.unparse({ fields: columns, data: rows }, { quotes: true, newline: "\r\n" });
writeFileSync("src/examples/crm/source-records.csv", `${csv}\r\n`);

const sheet = XLSX.utils.aoa_to_sheet([columns, ...rows.map((row) => row.map((value) => (value === "" ? null : value)))]);
const notes = XLSX.utils.aoa_to_sheet([["Fictional CRM export"], ["All records are synthetic. The first sheet holds the data."]]);
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, sheet, "Accounts");
XLSX.utils.book_append_sheet(book, notes, "Notes");
book.Props = { Title: "Fictional CRM accounts", CreatedDate: new Date(Date.UTC(2026, 10, 13)) };
const bytes = XLSX.write(book, { type: "buffer", bookType: "xlsx", compression: true });
writeFileSync("src/examples/crm/source-records.xlsx", bytes);
console.log(`wrote ${rows.length} records × ${columns.length} columns to source-records.csv and source-records.xlsx`);
