// All backend access goes through same-origin /api paths — never a hardcoded host.

async function req(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${method} ${path} failed (${res.status})`);
  return data;
}

// Downloads a blob response as a file — used for Excel exports (POST body,
// so a plain <a href download> won't work).
async function downloadBlob(method, path, body, fallbackName) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `${method} ${path} failed (${res.status})`);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  listDatasets: () => req('GET', '/api/datasets'),
  getDataset: (id) => req('GET', `/api/datasets/${id}`),
  uploadCSV: (name, csv) => req('POST', '/api/datasets', { name, csv }),
  deleteDataset: (id) => req('DELETE', `/api/datasets/${id}`),
  runTest: (id, params) => req('POST', `/api/datasets/${id}/test`, params),
  getChat: (id) => req('GET', `/api/datasets/${id}/chat`),
  sendChat: (id, message) => req('POST', `/api/datasets/${id}/chat`, { message }),
  getHead: (id, n = 10) => req('GET', `/api/datasets/${id}/head?n=${n}`),
  downloadHeadXlsx: (id, name, n = 10) => downloadBlob('GET', `/api/datasets/${id}/export.xlsx?n=${n}`, null, `${name}-head.xlsx`),
  downloadResultXlsx: (question, result) => downloadBlob('POST', '/api/export-result.xlsx', { question, result }, `${result.test}-result.xlsx`),
};
