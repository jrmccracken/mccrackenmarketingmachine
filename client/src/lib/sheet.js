// Turn an uploaded export (CSV, or Excel as LinkedIn and Meta provide) into CSV text for the importer.
// Excel exports often start with a note row above the real header, so we find the row that has a "Date" column.
const quote = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function fileToCsv(file) {
  if (!/\.(xlsx?|xlsm)$/i.test(file.name)) return file.text();
  const XLSX = await import('xlsx');
  const book = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  for (const name of book.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '' });
    const headerAt = rows.findIndex((r) => r.some((c) => /^(date|day)$/i.test(String(c).trim())));
    if (headerAt === -1) continue;
    return rows.slice(headerAt).filter((r) => r.some((c) => String(c).trim() !== '')).map((r) => r.map(quote).join(',')).join('\n');
  }
  throw new Error('Couldn\'t find a sheet with a "Date" column in that file. Export the daily metrics and try again.');
}
