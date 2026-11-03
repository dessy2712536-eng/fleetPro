// Talks to the Google Apps Script web app attached to your Google Sheet.
// The URL is set in public/config.js (window.FLEETPRO_CONFIG.apiUrl).

const TOKEN_KEY = 'fleetpro_token';

export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const setToken = t => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } };

export const apiUrl = () => {
  const url = (window.FLEETPRO_CONFIG && window.FLEETPRO_CONFIG.apiUrl) || '';
  return url.startsWith('http') ? url.trim() : '';
};

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details || {};
  }
}

export async function api(path, { method = 'GET', body, query } = {}) {
  const url = apiUrl();
  if (!url) throw new ApiError(0, 'The app is not connected to your Google Sheet yet. Add your Web App URL to config.js.');
  const cleanQuery = query ? Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')) : undefined;

  let res;
  try {
    // text/plain keeps this a "simple" request, which Google Apps Script accepts from any website.
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ method, path, query: cleanQuery, body, token: getToken() }),
      redirect: 'follow',
    });
  } catch {
    throw new ApiError(0, "Couldn't reach your Google Sheet. Check your internet connection and the Web App URL in config.js.");
  }

  let data;
  try { data = await res.json(); }
  catch { throw new ApiError(res.status, 'Google returned an unexpected response. Make sure the web app is deployed with access set to "Anyone".'); }

  if (!data.ok) {
    if (data.status === 401 && path !== '/auth/login') {
      setToken(null);
      window.dispatchEvent(new Event('fleetpro:logout'));
    }
    throw new ApiError(data.status, data.error || 'Request failed', data.details);
  }
  return data.data;
}

function toCsv(rows) {
  const esc = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
}

/** Fetch every matching row and save it as a CSV file. */
export async function downloadCsv(path, query, filename) {
  const data = await api(path, { query: { ...query, limit: 100000, offset: 0 } });
  const blob = new Blob([toCsv(data.rows || [])], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
