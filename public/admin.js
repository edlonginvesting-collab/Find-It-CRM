const adminForm = document.querySelector('#admin-login');
const adminStatus = document.querySelector('#admin-status');
adminForm.addEventListener('submit', async event => {
  event.preventDefault();
  adminStatus.textContent = 'Signing in…';
  const password = new FormData(adminForm).get('password');
  try {
    const response = await fetch('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to sign in');
    adminStatus.textContent = 'Admin access granted. Opening the CRM…';
    window.location.href = '/#app';
  } catch (error) { adminStatus.textContent = error instanceof Error ? error.message : 'Unable to sign in'; }
});
