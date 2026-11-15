/**
 * Shared Spreadsheet Utilities (.xlsx, .xls, .csv)
 * Handles BOM/UTF-16 CSV decoding, delimiter detection, strict DD-MM-YYYY / Excel serial
 * date normalization, and multi-format template/workbook downloads.
 */

export const decodeCsvBuffer = (arrayBuffer) => {
    const bytes = arrayBuffer instanceof Uint8Array
        ? arrayBuffer
        : new Uint8Array(arrayBuffer || new ArrayBuffer(0));
    let text = '';
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
        text = new TextDecoder('utf-16le').decode(bytes.subarray(2));
    } else if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
        text = new TextDecoder('utf-16be').decode(bytes.subarray(2));
    } else if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
        text = new TextDecoder('utf-8').decode(bytes.subarray(3));
    } else {
        text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        if (text.includes('\u0000')) {
            text = new TextDecoder('utf-16le').decode(bytes);
        }
    }
    return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
};

export const detectCsvDelimiter = (text = '') => {
    const lines = String(text || '').split('\n');
    const headerLine = lines.find((line) => line.trim() !== '') || '';
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let inQuotes = false;
    for (let i = 0; i < headerLine.length; i += 1) {
        const ch = headerLine[i];
        if (ch === '"') {
            if (inQuotes && headerLine[i + 1] === '"') {
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (!inQuotes && Object.prototype.hasOwnProperty.call(counts, ch)) {
            counts[ch] += 1;
        }
    }
    if (counts[';'] > counts[','] && counts[';'] >= counts['\t']) return ';';
    if (counts['\t'] > counts[','] && counts['\t'] > counts[';']) return '\t';
    return ',';
};

export const parseCsvMatrix = (text = '', delimiter = ',') => {
    const src = String(text || '');
    const rows = [];
    let currentRow = [];
    let currentCell = '';
    let inQuotes = false;

    for (let i = 0; i < src.length; i += 1) {
        const ch = src[i];
        if (inQuotes) {
            if (ch === '"') {
                if (src[i + 1] === '"') {
                    currentCell += '"';
                    i += 1;
                } else {
                    inQuotes = false;
                }
            } else {
                currentCell += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === delimiter) {
            currentRow.push(currentCell);
            currentCell = '';
        } else if (ch === '\n') {
            currentRow.push(currentCell);
            if (currentRow.some((cell) => String(cell).trim() !== '')) {
                rows.push(currentRow);
            }
            currentRow = [];
            currentCell = '';
        } else {
            currentCell += ch;
        }
    }

    if (currentCell.length > 0 || currentRow.length > 0) {
        currentRow.push(currentCell);
        if (currentRow.some((cell) => String(cell).trim() !== '')) {
            rows.push(currentRow);
        }
    }
    return rows;
};

export const parseCsvArrayBufferToMatrix = (arrayBuffer) => {
    const text = decodeCsvBuffer(arrayBuffer);
    if (!text.trim()) return [];
    const delimiter = detectCsvDelimiter(text);
    return parseCsvMatrix(text, delimiter).map((row) =>
        row.map((cell) => (cell !== undefined && cell !== null ? String(cell).trim() : ''))
    );
};

export const parseCsvArrayBufferToObjects = (arrayBuffer) => {
    const matrix = parseCsvArrayBufferToMatrix(arrayBuffer);
    if (matrix.length < 2) return [];

    const rawHeaders = matrix[0];
    const usedHeaders = new Set();
    const headers = rawHeaders.map((h, idx) => {
        const cleaned = String(h || '').trim();
        let candidate = cleaned || `Column ${idx + 1}`;
        let suffix = 2;
        while (usedHeaders.has(candidate)) {
            candidate = `${cleaned || `Column ${idx + 1}`} (${suffix})`;
            suffix += 1;
        }
        usedHeaders.add(candidate);
        return candidate;
    });

    const objects = [];
    for (let r = 1; r < matrix.length; r += 1) {
        const cells = matrix[r];
        const rowObj = {};
        let hasAnyValue = false;
        headers.forEach((header, idx) => {
            const val = cells[idx] !== undefined && cells[idx] !== null ? String(cells[idx]).trim() : '';
            if (val !== '') hasAnyValue = true;
            rowObj[header] = val;
        });
        if (hasAnyValue) objects.push(rowObj);
    }
    return objects;
};

const formatVerifiedUtcDate = (yearNum, monthNum, dayNum) => {
    if (!Number.isInteger(yearNum) || !Number.isInteger(monthNum) || !Number.isInteger(dayNum)) return '';
    if (yearNum < 1900 || yearNum > 2100 || monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) return '';
    const dt = new Date(Date.UTC(yearNum, monthNum - 1, dayNum));
    if (
        dt.getUTCFullYear() !== yearNum ||
        dt.getUTCMonth() + 1 !== monthNum ||
        dt.getUTCDate() !== dayNum
    ) {
        return '';
    }
    return `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
};

export const normalizeToIsoDate = (val) => {
    if (val === null || val === undefined || val === '') return '';
    if (val instanceof Date && !isNaN(val.getTime())) {
        return formatVerifiedUtcDate(val.getFullYear(), val.getMonth() + 1, val.getDate());
    }
    const str = String(val).trim();
    if (!str) return '';

    // 1. Numeric Excel Date Serial (e.g. 46340)
    if (/^\d{4,5}(\.\d+)?$/.test(str)) {
        const num = parseFloat(str);
        if (num > 1000 && num < 100000) {
            const utcDays = Math.floor(num - 25569);
            const date = new Date(utcDays * 86400 * 1000);
            if (!isNaN(date.getTime())) {
                return formatVerifiedUtcDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
            }
        }
    }

    // 2. ISO format: YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD
    const isoMatch = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (isoMatch) {
        return formatVerifiedUtcDate(parseInt(isoMatch[1], 10), parseInt(isoMatch[2], 10), parseInt(isoMatch[3], 10));
    }

    // 3. DD-MM-YYYY or DD/MM/YYYY or DD.MM.YYYY
    const dmyMatch = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (dmyMatch) {
        return formatVerifiedUtcDate(parseInt(dmyMatch[3], 10), parseInt(dmyMatch[2], 10), parseInt(dmyMatch[1], 10));
    }

    // 4. Fallback named-month date strings (e.g. "14 Nov 2026" or ISO timestamps with time)
    if (/[a-zA-Z]/.test(str) || str.includes('T')) {
        const parsed = new Date(str);
        if (!isNaN(parsed.getTime()) && parsed.getFullYear() >= 1900 && parsed.getFullYear() <= 2100) {
            return formatVerifiedUtcDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
        }
    }

    return '';
};

export const formatSpreadsheetCellValue = (val) => {
    if (val === undefined || val === null) return '';
    if (val instanceof Date && !isNaN(val.getTime())) {
        return normalizeToIsoDate(val);
    }
    return String(val).trim();
};

const escapeCsvField = (value) => {
    const str = value === undefined || value === null ? '' : String(value);
    if (/[",\r\n]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
};

export const buildCsvContent = (headers = [], rows = []) => {
    const lines = [];
    if (Array.isArray(headers) && headers.length > 0) {
        lines.push(headers.map(escapeCsvField).join(','));
    }
    (Array.isArray(rows) ? rows : []).forEach((row) => {
        if (!Array.isArray(row)) return;
        lines.push(row.map(escapeCsvField).join(','));
    });
    return '\uFEFF' + lines.join('\n') + '\n';
};

export const downloadSpreadsheetRows = ({
    headers = [],
    rows = [],
    filenameBase = 'template',
    format = 'xlsx',
    sheetName = 'Sheet1',
    xlsxLib = globalThis.XLSX
} = {}) => {
    const ext = String(format || 'xlsx').toLowerCase().replace(/^\./, '');
    const safeBase = String(filenameBase || 'template').replace(/[^a-zA-Z0-9._-]/g, '_');

    if (ext === 'xlsx' || ext === 'xls') {
        if (!xlsxLib || !xlsxLib.utils || typeof xlsxLib.writeFile !== 'function') {
            throw new Error('Spreadsheet library is still loading. Please try again in a moment.');
        }
        const aoa = [headers, ...(Array.isArray(rows) ? rows : [])];
        const ws = xlsxLib.utils.aoa_to_sheet(aoa);
        ws['!cols'] = headers.map((h) => ({ wch: Math.max(String(h || '').length + 4, 14) }));
        const wb = xlsxLib.utils.book_new();
        xlsxLib.utils.book_append_sheet(wb, ws, sheetName || 'Sheet1');
        xlsxLib.writeFile(wb, `${safeBase}.${ext}`, { bookType: ext });
        return `${safeBase}.${ext}`;
    }

    const csvContent = buildCsvContent(headers, rows);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', `${safeBase}.csv`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    return `${safeBase}.csv`;
};
