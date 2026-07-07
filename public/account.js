(() => {
  'use strict';
  const { api, formatMoney, formatDateTime, applyMasks, showToast, escapeHtml, onlyDigits } = window.CasaMateriais;
  let dashboard = null;

  function statusBadge(status) {
    const labels = { pendente: 'Pendente', confirmada: 'Confirmada', em_uso: 'Em uso', concluida: 'Concluída', cancelada: 'Cancelada' };
    const type = { pendente: 'warning', confirmada: 'info', em_uso: 'info', concluida: 'success', cancelada: 'danger' }[status] || 'gray';
    return `<span class="badge ${type}">${labels[status] || status}</span>`;
  }

  function paymentBadge(status) {
    return status === 'pago' ? '<span class="badge success">Pago</span>' : status === 'estornado' ? '<span class="badge gray">Estornado</span>' : '<span class="badge warning">Pendente</span>';
  }

  function maskDocument(value, type) {
    const digits = onlyDigits(value);
    if (type === 'PJ') return digits.slice(0, 14).replace(/(\d{2})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
    return digits.slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }

  function switchTab(tab) {
    document.querySelectorAll('.account-nav').forEach(button => {
      const active = button.dataset.accountTab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    document.querySelectorAll('.account-tab').forEach(section => section.classList.toggle('active', section.id === `account-${tab}`));
  }

  document.querySelectorAll('.account-nav').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.accountTab)));
  document.querySelectorAll('[data-open-account-tab]').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.openAccountTab)));

  function reservationCards(items) {
    if (!items.length) return '<div class="empty-state">Nenhuma reserva encontrada.</div>';
    return `<div class="client-reservation-list">${items.map(item => `
      <article class="client-reservation-card">
        <div><strong>${escapeHtml(item.contract)}</strong><span>${formatDateTime(item.createdAt)}</span></div>
        <div><strong>${escapeHtml(item.equipmentName)}</strong><span>${formatDateTime(item.start)} até ${formatDateTime(item.end)}</span></div>
        <div><strong>${formatMoney(item.total)}</strong><span>${paymentBadge(item.paymentStatus)}</span></div>
        <div>${statusBadge(item.status)}<button class="btn btn-outline btn-sm" data-client-reservation="${escapeHtml(item.id)}">Detalhes</button></div>
      </article>`).join('')}</div>`;
  }

  function render() {
    const { client, summary, loyalty, reservations, notifications = [] } = dashboard;
    document.getElementById('accountWelcome').textContent = client.clientType === 'PJ'
      ? `${client.tradeName || client.companyName} · conta empresarial`
      : `Olá, ${client.name}. Acompanhe suas locações e benefícios.`;
    document.getElementById('accountKpis').innerHTML = [
      ['Reservas', summary.totalReservations, '📅'],
      ['Em andamento', summary.activeReservations, '🧰'],
      ['Pagamentos pendentes', formatMoney(summary.pendingPayments), '💳'],
      [client.clientType === 'PJ' ? 'Desconto empresarial' : 'Pontos ObraFácil', client.clientType === 'PJ' ? '5%' : loyalty.points, client.clientType === 'PJ' ? '🏢' : '★']
    ].map(([label, value, icon]) => `<div class="kpi-card"><div class="kpi-head"><span>${label}</span><div class="kpi-icon">${icon}</div></div><div class="kpi-value">${value}</div></div>`).join('');

    document.getElementById('recentClientReservations').innerHTML = reservationCards(reservations.slice(0, 4));
    document.getElementById('clientReservations').innerHTML = reservationCards(reservations);
    document.querySelectorAll('[data-client-reservation]').forEach(button => button.addEventListener('click', () => openReservation(button.dataset.clientReservation)));

    if (client.clientType === 'PJ') {
      document.getElementById('benefitsTitle').textContent = 'Benefícios da conta empresarial';
      document.getElementById('clientBenefits').innerHTML = `
        <div class="business-benefit-card"><div class="loyalty-client-icon">🏢</div><div><strong>5% de desconto automático</strong><p>O desconto é aplicado sobre a locação e pode ser combinado com outras condições comerciais da loja.</p></div></div>
        <div class="loyalty-rules" style="margin-top:18px"><div><strong>${loyalty.completedRentals}</strong><span>locações concluídas</span></div><div><strong>Conta PJ</strong><span>histórico centralizado por empresa</span></div><div><strong>Contratos</strong><span>disponíveis nesta área</span></div></div>`;
    } else {
      const coupons = loyalty.coupons?.length ? loyalty.coupons.map(c => `<span class="coupon-chip">${escapeHtml(c.code)} · ${c.discountPercent}% OFF</span>`).join('') : '<span class="muted">Nenhum cupom ativo.</span>';
      const history = loyalty.history?.length ? `<div class="loyalty-history">${loyalty.history.map(h => `<div><strong>+${h.points} pontos</strong><span>${escapeHtml(h.description)}</span></div>`).join('')}</div>` : '<div class="empty-state">Seu histórico de pontos aparecerá aqui.</div>';
      document.getElementById('clientBenefits').innerHTML = `<div class="loyalty-client-card"><div class="loyalty-client-icon">★</div><div><strong>Nível ${escapeHtml(loyalty.level)}</strong><p>${loyalty.points} pontos · ${loyalty.completedRentals} locação(ões) concluída(s)</p><div class="loyalty-coupons">${coupons}</div></div></div>${history}`;
    }

    document.getElementById('accountNotificationBadge').textContent = notifications.length;
    document.getElementById('accountNotificationBadge').classList.toggle('hidden', !notifications.length);
    document.getElementById('clientNotifications').innerHTML = notifications.length ? `<div class="client-notification-list">${notifications.map(item => `<button class="client-notification ${escapeHtml(item.type || 'info')}" type="button" ${item.reservationId ? `data-client-notification="${escapeHtml(item.reservationId)}"` : ''}><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.message)}</span></button>`).join('')}</div>` : '<div class="empty-state">Nenhum aviso no momento.</div>';
    document.querySelectorAll('[data-client-notification]').forEach(button => button.addEventListener('click', () => openReservation(button.dataset.clientNotification)));

    fillProfile(client);
  }

  function fillProfile(client) {
    document.getElementById('profileName').value = client.name;
    document.getElementById('profileDocument').value = maskDocument(client.document, client.clientType);
    document.getElementById('profileDocumentLabel').textContent = client.clientType === 'PJ' ? 'CNPJ' : 'CPF';
    document.getElementById('profileEmail').value = client.email;
    document.getElementById('profilePhone').value = client.phone;
    document.getElementById('profileCep').value = client.cep;
    document.getElementById('profileAddress').value = client.address;
    document.getElementById('profileAddressNumber').value = client.addressNumber;
    document.getElementById('profileComplement').value = client.complement;
    document.getElementById('profileNeighborhood').value = client.neighborhood;
    document.getElementById('profileCity').value = client.city;
    document.getElementById('profileState').value = client.state;
    document.querySelectorAll('.company-profile').forEach(el => el.classList.toggle('hidden', client.clientType !== 'PJ'));
    document.getElementById('profileCompanyName').value = client.companyName || '';
    document.getElementById('profileTradeName').value = client.tradeName || '';
  }

  async function openReservation(id) {
    try {
      const item = await api(`/api/client/reservations/${encodeURIComponent(id)}`);
      const list = item.items.map(i => `<li>${i.quantity}x ${escapeHtml(i.name)}</li>`).join('');
      document.getElementById('clientReservationModalBody').innerHTML = `
        <div class="contract"><h2>${escapeHtml(item.contract)}</h2><p><strong>Status:</strong> ${statusBadge(item.status)} &nbsp; <strong>Pagamento:</strong> ${paymentBadge(item.paymentStatus)}</p>
        <p><strong>Equipamentos:</strong></p><ul>${list}</ul><p><strong>Período:</strong> ${formatDateTime(item.start)} até ${formatDateTime(item.end)}</p>
        <p><strong>A pagar agora:</strong> ${formatMoney(item.payNow || item.total)}<br><span class="small muted">Garantia vinculada: ${formatMoney(item.deposit)} · Total com garantia: ${formatMoney(item.totalWithGuarantee || ((item.payNow || item.total) + item.deposit))}</span></p>${item.assignedUnits?.length ? `<p><strong>Patrimônios:</strong> ${item.assignedUnits.map(unit => escapeHtml(unit.assetCode)).join(', ')}</p>` : ''}${item.contractDocument ? `<hr><pre class="contract-text">${escapeHtml(item.contractDocument.content)}</pre>` : ''}<div class="modal-action-bar"><a class="btn btn-primary" href="contrato.html?id=${encodeURIComponent(item.id)}" target="_blank">Abrir contrato / PDF</a><a class="btn btn-outline" href="nota-fiscal.html?id=${encodeURIComponent(item.id)}" target="_blank">Nota / recibo</a></div></div>`;
      document.getElementById('clientReservationModal').classList.remove('hidden');
    } catch (error) { showToast(error.message, 'error'); }
  }

  document.getElementById('closeClientReservationModal').addEventListener('click', () => document.getElementById('clientReservationModal').classList.add('hidden'));
  document.getElementById('clientReservationModal').addEventListener('click', event => { if (event.target.id === 'clientReservationModal') event.currentTarget.classList.add('hidden'); });

  document.getElementById('clientProfileForm').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const client = await api('/api/client/profile', { method: 'PATCH', body: JSON.stringify({
        phone: document.getElementById('profilePhone').value,
        cep: document.getElementById('profileCep').value,
        address: document.getElementById('profileAddress').value.trim(),
        addressNumber: document.getElementById('profileAddressNumber').value.trim(),
        complement: document.getElementById('profileComplement').value.trim(),
        neighborhood: document.getElementById('profileNeighborhood').value.trim(),
        city: document.getElementById('profileCity').value.trim(),
        state: document.getElementById('profileState').value.trim().toUpperCase()
      }) });
      dashboard.client = client;
      document.getElementById('accountNotificationBadge').textContent = notifications.length;
    document.getElementById('accountNotificationBadge').classList.toggle('hidden', !notifications.length);
    document.getElementById('clientNotifications').innerHTML = notifications.length ? `<div class="client-notification-list">${notifications.map(item => `<button class="client-notification ${escapeHtml(item.type || 'info')}" type="button" ${item.reservationId ? `data-client-notification="${escapeHtml(item.reservationId)}"` : ''}><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.message)}</span></button>`).join('')}</div>` : '<div class="empty-state">Nenhum aviso no momento.</div>';
    document.querySelectorAll('[data-client-notification]').forEach(button => button.addEventListener('click', () => openReservation(button.dataset.clientNotification)));

    fillProfile(client);
      showToast('Dados atualizados com sucesso.');
    } catch (error) { showToast(error.message, 'error'); }
  });

  document.getElementById('profileCep').addEventListener('blur', async event => {
    const cep = onlyDigits(event.target.value);
    if (cep.length !== 8) return;
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await response.json();
      if (data.erro) return;
      document.getElementById('profileAddress').value = data.logradouro || '';
      document.getElementById('profileNeighborhood').value = data.bairro || '';
      document.getElementById('profileCity').value = data.localidade || '';
      document.getElementById('profileState').value = data.uf || '';
    } catch {}
  });

  document.getElementById('accountLogoutButton').addEventListener('click', async () => {
    try { await api('/api/client/logout', { method: 'POST' }); } catch {}
    location.href = 'index.html';
  });

  async function init() {
    try {
      dashboard = await api('/api/client/dashboard');
      render();
      applyMasks();
    } catch {
      location.href = 'index.html';
    }
  }
  init();
})();
