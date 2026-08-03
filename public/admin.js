const adminForm = document.querySelector('#admin-login');
const adminStatus = document.querySelector('#admin-status');
const adminApi = async (url, options) => { const response = await fetch(url, { credentials: 'same-origin', ...options }); const data = response.status === 204 ? null : await response.json(); if (!response.ok) throw new Error(data?.error || 'Request failed'); return data; };
async function renderAdmin() {
  document.body.innerHTML = '<div class="crm-shell"><header class="site-header"><a class="brand" href="/admin#dashboard">◆ FIND-IT CRM ADMIN</a><button class="button ghost" id="admin-logout">Log out</button></header><main id="admin-main"><section class="section"><p class="loading">Loading administration…</p></section></main></div>';
  try { const d = await adminApi('/api/admin/overview'); document.querySelector('#admin-main').innerHTML = `<section class="section"><div class="eyebrow">ADMINISTRATION</div><h1>System overview</h1><p>Operational visibility for the entire Find-It CRM platform.</p><div class="metrics"><div><small>Organizations</small><b>${d.organizations}</b></div><div><small>Active users</small><b>${d.users}</b></div><div><small>Leads</small><b>${d.leads}</b></div><div><small>Deals</small><b>${d.deals}</b></div></div><div class="table">${d.billing.map(x => `<div class="row"><b>${x.billing_status}</b><span>${x.count} organizations</span></div>`).join('') || '<div class="row"><span>No billing records yet.</span></div>'}</div></section>`; document.querySelector('#admin-logout').onclick=async()=>{await adminApi('/api/admin/logout',{method:'POST'});location.href='/admin'}; } catch (e) { document.querySelector('#admin-main').innerHTML = `<section class="section"><h1>Admin session unavailable</h1><p>${e.message}</p><a class="button primary" href="/admin">Sign in again</a></section>`; }
}
if (location.hash === '#dashboard') renderAdmin();
if (!adminForm) { /* Admin dashboard is rendered after authentication. */ }
if (adminForm)
adminForm.addEventListener('submit', async event => {
  event.preventDefault();
  adminStatus.textContent = 'Signing in…';
  const password = new FormData(adminForm).get('password');
  try {
    const response = await fetch('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to sign in');
    adminStatus.textContent = 'Admin access granted. Opening the CRM…';
    window.location.href = '/#home';
  } catch (error) { adminStatus.textContent = error instanceof Error ? error.message : 'Unable to sign in'; }
});
