const planGrid = document.querySelector('#plan-grid');
let selectedPlan = 'professional';
const money = cents => `$${(cents / 100).toFixed(0)}`;
async function loadPlans() {
  try {
    const response = await fetch('/api/plans'); const data = await response.json();
    planGrid.innerHTML = data.items.map((plan, index) => `<article class="plan ${index === 1 ? 'featured' : ''}"><small>${index === 1 ? 'MOST POPULAR' : 'PLAN'}</small><h3>${plan.name}</h3><div class="price">${money(plan.monthlyPriceCents)}<span>/month</span></div><p>${plan.includedCredits} marketplace credits included</p><a class="button ${index === 1 ? 'primary' : 'ghost'}" href="#signup" data-plan="${plan.id}">Start with ${plan.name}</a></article>`).join('');
    planGrid.querySelectorAll('[data-plan]').forEach(link => link.addEventListener('click', () => { selectedPlan = link.dataset.plan; }));
  } catch { planGrid.innerHTML = '<p>Plans are temporarily unavailable. Please try again shortly.</p>'; }
}
document.querySelector('#signup-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; const status = document.querySelector('#form-status'); const body = Object.fromEntries(new FormData(form)); status.textContent = 'Creating your workspace…';
  try { const response = await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to create workspace'); const checkout = await fetch('/api/billing/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationId: data.organizationId, planId: selectedPlan }) }); const checkoutData = await checkout.json(); if (checkout.ok && checkoutData.url) { window.location.href = checkoutData.url; return; } status.textContent = 'Workspace created. Billing setup is not available yet; your trial is ready.'; form.reset(); } catch (error) { status.textContent = error.message; }
});
loadPlans();
