const planGrid = document.querySelector('#plan-grid');
const form = document.querySelector('#signup-form');
const money = cents => `$${(cents / 100).toFixed(0)}`;
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const featureLabel = feature => feature.replace(/([A-Z])/g, ' $1').replace(/^./, character => character.toUpperCase());

async function loadPlans() {
  try {
    const response = await fetch('/api/plans');
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.items)) throw new Error('Plans unavailable');
    planGrid.innerHTML = data.items.map((plan, index) => {
      const enabledFeatures = Object.entries(plan.features || {}).filter(([, enabled]) => enabled).map(([feature]) => featureLabel(feature));
      const features = enabledFeatures.length ? enabledFeatures.join(', ') : 'Core CRM workspace';
      const users = Number(plan.maxUsers) === 1 ? '1 user' : `up to ${escapeHtml(plan.maxUsers)} users`;
      return `<article class="plan ${index === 1 ? 'featured' : ''}"><small>${index === 1 ? 'MOST POPULAR' : 'PLAN'}</small><h3>${escapeHtml(plan.name)}</h3><div class="price">${money(Number(plan.monthlyPriceCents))}<span>/month</span></div><p>${escapeHtml(plan.includedCredits)} usage credits included · ${users}</p><p class="plan-features">${escapeHtml(features)}</p><a class="button ${index === 1 ? 'primary' : 'ghost'}" href="#signup" data-plan="${escapeHtml(plan.id)}">Use the core workspace</a></article>`;
    }).join('');
  } catch { planGrid.innerHTML = '<p>Plans are temporarily unavailable. Please try again shortly.</p>'; }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const status = document.querySelector('#form-status');
  const body = Object.fromEntries(new FormData(form));
  if (!String(body.organizationName || '').trim()) delete body.organizationName;
  status.textContent = 'Creating your workspace…';
  try {
    const response = await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to create workspace');
    status.textContent = 'Workspace created. Your core CRM is ready; plans add usage and features when you need them.';
    form.reset();
  } catch (error) { status.textContent = error instanceof Error ? error.message : 'Unable to create workspace'; }
});

loadPlans();
