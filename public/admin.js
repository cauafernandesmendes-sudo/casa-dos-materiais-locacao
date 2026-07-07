(() => {
  'use strict';

  const { api, formatMoney, formatDateTime, showToast, applyMasks, escapeHtml, offsetDate } = window.CasaMateriais;
  const loginPage = document.getElementById('loginPage');
  const adminApp = document.getElementById('adminApp');
  const adminModal = document.getElementById('adminModal');

  const state = {
    admin: null,
    dashboard: null,
    equipment: [],
    reservations: [],
    maintenance: [],
    finance: { received: 0, pending: 0, deposits: 0, lateFees: 0, accountsReceivable: 0, accountsPayable: 0, averageTicket: 0, expectedBalance: 0, receivableRows: [], payableRows: [], rows: [] },
    loyalty: { clients: [], topClients: [], distributedPoints: 0, rewardedClients: 0, activeCoupons: 0 },
    assistant: { services: [] },
    clients: [],
    units: [],
    goals: [],
    deliveries: [],
    calendarDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  };

  function safeServiceIcon(icon, serviceName = '') {
    const value = String(icon || '').trim();
    const name = String(serviceName || '').toLowerCase();
    const unsupported = new Set(['🪚', '🪜']);
    if (!value || unsupported.has(value)) {
      if (name.includes('madeira') || name.includes('estrutura')) return '🔨';
      if (name.includes('altura')) return '⬆️';
      if (name.includes('limpeza') || name.includes('pós-obra')) return '✨';
      return '🧰';
    }
    return value;
  }

  function showLogin() {
    state.admin = null;
    loginPage.classList.remove('hidden');
    adminApp.classList.add('hidden');
  }

  async function openApp(admin) {
    state.admin = admin;
    loginPage.classList.add('hidden');
    adminApp.classList.remove('hidden');
    document.querySelector('.admin-user strong').textContent = admin.name || 'Administrador';
    await renderAll();
  }

  document.getElementById('loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Entrando...';
    try {
      const admin = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: document.getElementById('adminEmail').value.trim(),
          password: document.getElementById('adminPassword').value
        })
      });
      await openApp(admin);
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Entrar';
    }
  });

  document.getElementById('logoutButton').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    showLogin();
  });

  document.getElementById('refreshAdminButton').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = '↻ Atualizando...';
    await renderAll();
    button.disabled = false;
    button.textContent = '↻ Atualizar';
  });

  document.querySelectorAll('.sidebar-link[data-tab]').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.tab)));
  document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.go)));

  async function switchTab(tab) {
    document.querySelectorAll('.sidebar-link[data-tab]').forEach(button => {
      const active = button.dataset.tab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    document.querySelectorAll('.tab-page').forEach(page => page.classList.toggle('active', page.id === `tab-${tab}`));
    const titles = { dashboard: 'Dashboard', reservations: 'Reservas', calendar: 'Calendário', clients: 'Clientes', equipment: 'Equipamentos', assets: 'Patrimônio', maintenance: 'Manutenção', finance: 'Financeiro', deliveries: 'Entregas', loyalty: 'Programa ObraFácil', goals: 'Metas e objetivos' };
    document.getElementById('topbarTitle').textContent = titles[tab];
    await renderAll();
  }

  function statusBadge(status) {
    const labels = { pendente: 'Pendente', confirmada: 'Confirmada', em_uso: 'Em uso', concluida: 'Concluída', cancelada: 'Cancelada', disponivel: 'Disponível', manutencao: 'Manutenção', indisponivel: 'Indisponível', reservado: 'Reservado' };
    const types = { pendente: 'warning', confirmada: 'info', em_uso: 'info', concluida: 'success', cancelada: 'danger', disponivel: 'success', manutencao: 'warning', indisponivel: 'danger', reservado: 'warning' };
    return `<span class="badge ${types[status] || 'gray'}">${escapeHtml(labels[status] || status)}</span>`;
  }

  function paymentBadge(status) {
    if (status === 'pago') return '<span class="badge success">Pago</span>';
    if (status === 'estornado') return '<span class="badge gray">Estornado</span>';
    return '<span class="badge warning">Pendente</span>';
  }

  function reviewInfo(item) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const review = new Date(`${item.nextReview}T00:00:00`);
    const days = Math.ceil((review - today) / 86400000);
    return { days, due: days < 0, soon: days >= 0 && days <= 15 };
  }

  function renderColumnChart(targetId, data, money = false) {
    const target = document.getElementById(targetId);
    const max = Math.max(1, ...data.map(item => Number(item.value || 0)));
    if (!data.some(item => Number(item.value) > 0)) {
      target.innerHTML = empty('Ainda não há dados suficientes para este gráfico.');
      return;
    }
    target.innerHTML = `<div class="column-chart">${data.map(item => {
      const value = Number(item.value || 0);
      const height = Math.max(5, Math.round((value / max) * 100));
      return `<div class="column-chart-item" title="${escapeHtml(item.label)}: ${money ? formatMoney(value) : value}"><div class="column-chart-value">${money ? formatMoney(value) : value}</div><div class="column-chart-track"><span style="height:${height}%"></span></div><div class="column-chart-label">${escapeHtml(item.label)}</div></div>`;
    }).join('')}</div>`;
  }

  function renderStatusChart(data) {
    const target = document.getElementById('reservationStatusChart');
    const colors = ['#d97706', '#2563eb', '#7c3aed', '#15803d', '#6b7280'];
    const total = data.reduce((sum, item) => sum + Number(item.value || 0), 0);
    if (!total) {
      target.innerHTML = empty('Nenhuma reserva cadastrada.');
      return;
    }
    let cursor = 0;
    const segments = data.map((item, index) => {
      const start = cursor;
      cursor += (Number(item.value || 0) / total) * 360;
      return `${colors[index]} ${start}deg ${cursor}deg`;
    }).join(', ');
    target.innerHTML = `<div class="donut-chart-wrap"><div class="donut-chart" style="background:conic-gradient(${segments})"><div><strong>${total}</strong><span>reservas</span></div></div><div class="chart-legend">${data.map((item, index) => `<div><span style="background:${colors[index]}"></span><b>${escapeHtml(item.label)}</b><strong>${item.value}</strong></div>`).join('')}</div></div>`;
  }

  function renderHorizontalBars(targetId, data, valueKey, suffix = '') {
    const target = document.getElementById(targetId);
    const max = Math.max(1, ...data.map(item => Number(item[valueKey] || 0)));
    if (!data.length) {
      target.innerHTML = empty('Ainda não há dados para exibir.');
      return;
    }
    target.innerHTML = `<div class="horizontal-chart">${data.map(item => {
      const value = Number(item[valueKey] || 0);
      const width = Math.max(4, Math.round((value / max) * 100));
      return `<div class="horizontal-chart-row"><div class="horizontal-chart-head"><span>${escapeHtml(item.label)}</span><strong>${value}${suffix}</strong></div><div class="horizontal-chart-track"><span style="width:${width}%"></span></div>${valueKey === 'total' ? `<div class="horizontal-chart-note">${item.available} unidade(s) operacional(is)</div>` : ''}</div>`;
    }).join('')}</div>`;
  }

  function renderDashboard() {
    const dashboard = state.dashboard;
    document.getElementById('kpiGrid').innerHTML = [
      ['Unidades cadastradas', dashboard.totalUnits, '🧰', `${dashboard.available} operacionais`],
      ['Locações ativas', dashboard.active, '📅', `${dashboard.totalReservations} reservas no total`],
      ['Receita recebida', formatMoney(dashboard.revenue), '💰', 'Pagamentos confirmados'],
      ['Ticket médio', formatMoney(dashboard.averageTicket || 0), '🎟️', 'Média por reserva, sem caução'],
      ['Contas a receber', formatMoney(dashboard.accountsReceivable || dashboard.pendingValue || 0), '📥', 'Reservas ainda não pagas'],
      ['Contas a pagar', formatMoney(dashboard.accountsPayable || 0), '📤', 'Despesas operacionais pendentes'],
      ['Devoluções atrasadas', dashboard.overdueCount, '⚠️', dashboard.overdueCount ? 'Precisam de acompanhamento' : 'Nenhum atraso'],
      ['Clientes cadastrados', dashboard.clientsCount, '👥', `${dashboard.maintenanceUnits} unidade(s) fora de operação`],
      ['Locações pendentes', formatMoney(dashboard.pendingValue), '⏳', 'Valores de locação/frete pendentes']
    ].map(([label, value, icon, note]) => `<div class="kpi-card"><div class="kpi-head"><span>${label}</span><div class="kpi-icon">${icon}</div></div><div class="kpi-value">${value}</div><div class="kpi-note">${note}</div></div>`).join('');

    renderColumnChart('monthlyRevenueChart', dashboard.monthlyRevenue || [], true);
    renderStatusChart(dashboard.statusCounts || []);
    renderHorizontalBars('categoryStockChart', dashboard.categoryStock || [], 'total');
    renderHorizontalBars('topEquipmentChart', dashboard.topEquipment || [], 'quantity', ' un.');

    document.getElementById('recentReservations').innerHTML = dashboard.recent.length
      ? tableHtml(['Contrato', 'Cliente', 'Equipamento', 'Retirada', 'Status'], dashboard.recent.map(reservation => [
          escapeHtml(reservation.contract), escapeHtml(reservation.clientName), escapeHtml(reservation.equipmentName), formatDateTime(reservation.start), statusBadge(reservation.status)
        ]))
      : empty('Nenhuma reserva recebida ainda.');

    document.getElementById('operationalAlertBadge').textContent = `${(dashboard.alerts || []).length} alerta(s)`;
    document.getElementById('operationalAlerts').innerHTML = (dashboard.alerts || []).length
      ? dashboard.alerts.map(item => `<div class="alert-item ${item.type === 'danger' ? 'critical' : ''}"><div class="alert-main"><span class="alert-dot"></span><div><strong>${escapeHtml(item.title)}</strong><div class="small muted">${escapeHtml(item.detail)}</div></div></div><button class="btn btn-outline btn-sm" onclick="openReservation('${escapeHtml(item.reservationId)}')">Ver</button></div>`).join('')
      : empty('Nenhum alerta operacional no momento.');

    document.getElementById('reviewCountBadge').textContent = `${dashboard.reviews.length} alerta(s)`;
    document.getElementById('reviewAlerts').innerHTML = dashboard.reviews.length
      ? [...dashboard.reviews].sort((a, b) => new Date(a.nextReview) - new Date(b.nextReview)).map(item => {
          const info = reviewInfo(item);
          return `<div class="alert-item ${info.due ? 'critical' : ''}"><div class="alert-main"><span class="alert-dot"></span><div><strong>${escapeHtml(item.name)}</strong><div class="small muted">${info.due ? `Revisão vencida há ${Math.abs(info.days)} dia(s)` : `Revisão em ${info.days} dia(s)`}</div></div></div><button class="btn btn-outline btn-sm" onclick="openMaintenance('${escapeHtml(item.id)}')">Registrar</button></div>`;
        }).join('')
      : empty('Nenhuma revisão próxima.');

    renderNotifications();

    document.getElementById('dashboardUpdated').textContent = `Atualizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  }

  function renderReservations() {
    const search = (document.getElementById('reservationSearch')?.value || '').toLowerCase();
    const filter = document.getElementById('reservationFilter')?.value || '';
    const paymentFilter = document.getElementById('reservationPaymentFilter')?.value || '';
    const reservations = state.reservations.filter(reservation =>
      (!filter || reservation.status === filter) &&
      (!paymentFilter || reservation.paymentStatus === paymentFilter) &&
      `${reservation.clientName} ${reservation.contract} ${reservation.equipmentName}`.toLowerCase().includes(search)
    );
    const rows = reservations.map(reservation => [
      `<strong>${escapeHtml(reservation.contract)}</strong><div class="small muted">${escapeHtml(reservation.paymentMethod)}</div>`,
      `${escapeHtml(reservation.clientName)}<div class="small muted">${escapeHtml(reservation.phone)}</div>`,
      `${escapeHtml(reservation.equipmentName)}<div class="small muted">${reservation.items?.length || 1} item(ns) · ${reservation.quantity} unidade(s)</div>`,
      `${formatDateTime(reservation.start)}<div class="small muted">até ${formatDateTime(reservation.end)}</div>`,
      formatMoney(reservation.payNow || reservation.total),
      statusBadge(reservation.status),
      paymentBadge(reservation.paymentStatus),
      `<div class="table-actions"><button class="btn btn-outline btn-sm" onclick="openReservation('${escapeHtml(reservation.id)}')">Ver</button><button class="btn btn-primary btn-sm" onclick="advanceReservation('${escapeHtml(reservation.id)}')">Avançar</button></div>`
    ]);
    document.getElementById('reservationTable').innerHTML = rows.length
      ? tableHtml(['Contrato', 'Cliente', 'Equipamento', 'Período', 'A pagar agora', 'Status', 'Pagamento', 'Ações'], rows)
      : empty('Nenhuma reserva encontrada.');
  }

  document.getElementById('reservationSearch').addEventListener('input', renderReservations);
  document.getElementById('reservationFilter').addEventListener('change', renderReservations);
  document.getElementById('reservationPaymentFilter').addEventListener('change', renderReservations);
  document.getElementById('deliverySearch')?.addEventListener('input', renderDeliveries);
  document.getElementById('deliveryStatusFilter')?.addEventListener('change', renderDeliveries);

  window.advanceReservation = async function advanceReservation(reservationId) {
    const reservation = state.reservations.find(item => item.id === reservationId);
    if (!reservation) return;
    const next = { pendente: 'confirmada', confirmada: 'em_uso', em_uso: 'concluida', concluida: 'concluida', cancelada: 'cancelada' };
    try {
      const updated = await api(`/api/admin/reservations/${encodeURIComponent(reservationId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next[reservation.status] })
      });
      if (updated.loyaltyAward) {
        const reward = updated.loyaltyAward;
        showToast(`Reserva concluída: +${reward.points} pontos ObraFácil. Total: ${reward.totalPoints}.`);
        if (reward.coupon) showToast(`Novo cupom gerado: ${reward.coupon.code} — 10% OFF.`, 'info');
      } else {
        showToast(`Reserva atualizada para ${next[reservation.status].replace('_', ' ')}.`);
      }
      await renderAll();
    } catch (error) {
      handleAdminError(error);
    }
  };

  window.cancelReservation = async function cancelReservation(reservationId) {
    if (!window.confirm('Deseja cancelar esta reserva?')) return;
    try {
      await api(`/api/admin/reservations/${encodeURIComponent(reservationId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelada' })
      });
      closeModal();
      showToast('Reserva cancelada.', 'info');
      await renderAll();
    } catch (error) {
      handleAdminError(error);
    }
  };

  function inspectionSummary(inspections = []) {
    if (!inspections.length) return '<span class="muted">Nenhum checklist registrado.</span>';
    return `<div class="inspection-history">${inspections.map(item => {
      const type = item.type === 'retirada' ? 'Retirada' : 'Devolução';
      const badge = item.conditionStatus === 'avariado' ? 'danger' : item.conditionStatus === 'atencao' ? 'warning' : 'success';
      const label = item.conditionStatus === 'avariado' ? 'com avaria' : item.conditionStatus === 'atencao' ? 'atenção' : 'aprovado';
      const checked = Object.entries(item.checklist || {}).filter(([, value]) => value).map(([key]) => ({ power: 'Funcionamento', cables: 'Cabos/estrutura', safety: 'Segurança', accessories: 'Acessórios', cleanliness: 'Limpeza' }[key] || key));
      const photos = (item.photos || []).length ? `<div class="inspection-thumbs">${item.photos.map(src => `<img src="${src}" alt="Foto da inspeção">`).join('')}</div>` : '';
      return `<div class="inspection-record"><div><span class="badge ${badge}">${type}: ${label}</span><small>${formatDateTime(item.inspectedAt)}${item.responsibleName ? ` · ${escapeHtml(item.responsibleName)}` : ''}</small></div>${checked.length ? `<p><strong>Itens conferidos:</strong> ${checked.join(', ')}</p>` : ''}${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : ''}${photos}</div>`;
    }).join('')}</div>`;
  }

  window.openReservation = async function openReservation(reservationId) {
    try {
      const reservation = await api(`/api/admin/reservations/${encodeURIComponent(reservationId)}`);
      const assets = reservation.assignedUnits?.length
        ? reservation.assignedUnits.map(unit => `<span class="asset-chip">${escapeHtml(unit.equipmentName)} · ${escapeHtml(unit.assetCode)}</span>`).join('')
        : '<span class="muted">As unidades são vinculadas automaticamente na retirada.</span>';
      openModal('Detalhes da reserva', `
        <div class="form-grid reservation-detail-grid">
          <div><strong>Contrato</strong><p>${escapeHtml(reservation.contract)}</p></div><div><strong>Status</strong><p>${statusBadge(reservation.status)}</p></div>
          <div><strong>Cliente</strong><p>${escapeHtml(reservation.clientName)}<br>${escapeHtml(reservation.document)}<br>${escapeHtml(reservation.phone)}</p></div><div><strong>Contato</strong><p>${escapeHtml(reservation.email)}<br>${escapeHtml(reservation.address)}, ${escapeHtml(reservation.city)} - ${escapeHtml(reservation.state)}</p></div>
          <div><strong>Equipamentos</strong><p>${(reservation.items || []).map(item => `${item.quantity}x ${escapeHtml(item.name)}${item.accessory ? ` — ${escapeHtml(item.accessory)}` : ''}`).join('<br>') || escapeHtml(reservation.equipmentName)}</p>${reservation.packageName ? `<span class="badge success">${escapeHtml(reservation.packageName)}</span>` : ''}</div><div><strong>Período</strong><p>${formatDateTime(reservation.start)}<br>${formatDateTime(reservation.end)}</p></div>
          <div><strong>Pagamento</strong><p>${escapeHtml(reservation.paymentMethod)}<br>${paymentBadge(reservation.paymentStatus)}</p></div><div><strong>Valores</strong><p><strong>A pagar agora:</strong> ${formatMoney(reservation.payNow || reservation.total)}<br><span class="small muted">Garantia vinculada: ${formatMoney(reservation.deposit)}<br>Total com garantia: ${formatMoney(reservation.totalWithGuarantee || ((reservation.payNow || reservation.total) + reservation.deposit))}${reservation.discount > 0 ? `<br>Desconto: ${formatMoney(reservation.discount)}` : ''}</span></p></div>
          <div class="full"><strong>Patrimônios vinculados</strong><div class="asset-chip-list">${assets}</div></div>
          <div class="full"><strong>Observações</strong><p>${escapeHtml(reservation.notes || 'Nenhuma observação.')}</p></div>
          <div class="full"><strong>Checklists e evidências</strong>${inspectionSummary(reservation.inspections)}</div>
        </div>
        <div class="modal-action-bar"><a class="btn btn-outline" href="contrato.html?id=${encodeURIComponent(reservation.id)}" target="_blank">Contrato / PDF</a><a class="btn btn-outline" href="nota-fiscal.html?id=${encodeURIComponent(reservation.id)}" target="_blank">Nota / recibo</a>${reservation.delivery ? `<button class="btn btn-outline" onclick="openDeliveryControl('${escapeHtml(reservation.id)}')">Entrega / mapa</button>` : ''}<button class="btn btn-outline" onclick="openChecklist('${escapeHtml(reservation.id)}','retirada')">Checklist de retirada</button><button class="btn btn-outline" onclick="openChecklist('${escapeHtml(reservation.id)}','devolucao')">Checklist de devolução</button><button class="btn btn-danger" onclick="cancelReservation('${escapeHtml(reservation.id)}')">Cancelar</button><button class="btn btn-primary" onclick="advanceReservation('${escapeHtml(reservation.id)}');closeModal()">Avançar status</button></div>`);
    } catch (error) { handleAdminError(error); }
  };

  function resizeInspectionPhoto(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const image = new Image();
        image.onerror = reject;
        image.onload = () => {
          const max = 1100;
          const scale = Math.min(1, max / Math.max(image.width, image.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', .72));
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  window.openChecklist = async function openChecklist(reservationId, type) {
    const reservation = state.reservations.find(item => item.id === reservationId);
    if (!reservation) return;
    openModal(`Checklist de ${type}`, `<form id="inspectionForm">
      <div class="form-grid">
        <div class="form-group full"><label>Reserva / equipamento</label><input value="${escapeHtml(reservation.contract)} — ${escapeHtml(reservation.equipmentName)}" disabled></div>
        <div class="form-group"><label>Responsável pela inspeção</label><input id="inspResponsible" value="${escapeHtml(state.admin?.name || 'Administrador')}" required></div>
        <div class="form-group"><label>Resultado da inspeção</label><select id="inspCondition"><option value="bom">Bom / aprovado</option><option value="atencao">Requer atenção</option><option value="avariado">Com avaria</option></select></div>
        <div class="form-group full"><label>Itens verificados</label><div class="checklist-grid">
          <label><input type="checkbox" data-check="power" checked> Liga e funciona corretamente</label>
          <label><input type="checkbox" data-check="cables" checked> Cabos, estrutura e carcaça</label>
          <label><input type="checkbox" data-check="safety" checked> Proteções e itens de segurança</label>
          <label><input type="checkbox" data-check="accessories" checked> Acessórios completos</label>
          <label><input type="checkbox" data-check="cleanliness" checked> Limpeza e conservação</label>
        </div></div>
        <div class="form-group full"><label>Fotos da inspeção (até 4)</label><input id="inspPhotos" type="file" accept="image/*" multiple><span class="small muted">As fotos ficam vinculadas ao checklist e ajudam a comprovar o estado do equipamento.</span></div>
        <div class="form-group full"><label>Observações</label><textarea id="inspNotes" placeholder="Marcas existentes, peças faltantes, testes realizados e providências necessárias."></textarea></div>
      </div>
      <button class="btn btn-primary btn-block" style="margin-top:18px">Salvar checklist e evidências</button>
    </form>`);
    document.getElementById('inspectionForm').addEventListener('submit', async event => {
      event.preventDefault();
      const button = event.currentTarget.querySelector('button[type="submit"]');
      button.disabled = true; button.textContent = 'Salvando...';
      try {
        const files = [...document.getElementById('inspPhotos').files].slice(0, 4);
        const photos = await Promise.all(files.map(resizeInspectionPhoto));
        const checklist = {};
        document.querySelectorAll('[data-check]').forEach(input => { checklist[input.dataset.check] = input.checked; });
        await api(`/api/admin/reservations/${encodeURIComponent(reservationId)}/inspections`, {
          method: 'POST', body: JSON.stringify({ type, conditionStatus: val('inspCondition'), notes: val('inspNotes'), responsibleName: val('inspResponsible'), checklist, photos })
        });
        closeModal(); showToast('Checklist e fotos registrados com sucesso.'); await renderAll();
      } catch (error) { handleAdminError(error); button.disabled = false; button.textContent = 'Salvar checklist e evidências'; }
    });
  };

  function renderClients() {
    const search = (document.getElementById('clientAdminSearch')?.value || '').toLowerCase();
    const type = document.getElementById('clientTypeFilter')?.value || '';
    const clients = state.clients.filter(client => (!type || client.clientType === type) && `${client.name} ${client.companyName || ''} ${client.tradeName || ''} ${client.document} ${client.email}`.toLowerCase().includes(search));
    const rows = clients.map(client => [
      `<strong>${escapeHtml(client.clientType === 'PJ' ? (client.tradeName || client.companyName || client.name) : client.name)}</strong><div class="small muted">${client.clientType === 'PJ' ? `Responsável: ${escapeHtml(client.name)}` : escapeHtml(client.email)}</div>`,
      `<span class="badge ${client.clientType === 'PJ' ? 'info' : 'gray'}">${client.clientType === 'PJ' ? 'CNPJ' : 'CPF'}</span><div class="small muted">${escapeHtml(client.document)}</div>`,
      `${escapeHtml(client.phone)}<div class="small muted">${escapeHtml(client.city)} - ${escapeHtml(client.state)}</div>`,
      String(client.reservations),
      formatMoney(client.totalPaid),
      client.clientType === 'PJ' ? '<span class="badge success">5% empresa</span>' : `<span class="badge success">${client.points} pts · ${escapeHtml(client.level)}</span>`
    ]);
    document.getElementById('clientsTable').innerHTML = rows.length ? tableHtml(['Cliente','Documento','Contato','Reservas','Total pago','Benefício'], rows) : empty('Nenhum cliente encontrado.');
  }

  document.getElementById('clientAdminSearch')?.addEventListener('input', renderClients);
  document.getElementById('clientTypeFilter')?.addEventListener('change', renderClients);

  function renderEquipment() {
    const search = (document.getElementById('equipmentSearch')?.value || '').toLowerCase();
    const category = document.getElementById('equipmentCategoryFilter')?.value || '';
    const equipment = state.equipment.filter(item =>
      (!category || item.category === category) &&
      `${item.name} ${item.category} ${item.serial}`.toLowerCase().includes(search)
    );
    const rows = equipment.map(item => {
      const info = reviewInfo(item);
      const reviewLabel = info.due ? '<span class="badge danger">Vencida</span>' : info.soon ? `<span class="badge warning">${info.days} dias</span>` : '<span class="badge success">Em dia</span>';
      return [
        `<strong>${escapeHtml(item.name)}</strong><div class="small muted">${escapeHtml(item.category)}</div>`,
        escapeHtml(item.serial), item.total, formatMoney(item.daily), statusBadge(item.status),
        `${new Date(`${item.nextReview}T12:00:00`).toLocaleDateString('pt-BR')} ${reviewLabel}`,
        `<div class="table-actions"><button class="btn btn-outline btn-sm" onclick="openEquipment('${escapeHtml(item.id)}')">Editar</button><button class="btn btn-warning btn-sm" onclick="openMaintenance('${escapeHtml(item.id)}')">Revisão</button></div>`
      ];
    });
    document.getElementById('equipmentTable').innerHTML = rows.length
      ? tableHtml(['Equipamento', 'Patrimônio', 'Estoque', 'Diária', 'Status', 'Próxima revisão', 'Ações'], rows)
      : empty('Nenhum equipamento encontrado.');
  }

  document.getElementById('equipmentSearch').addEventListener('input', renderEquipment);
  document.getElementById('equipmentCategoryFilter').addEventListener('change', renderEquipment);
  document.getElementById('newEquipmentButton').addEventListener('click', () => openEquipment());

  window.openEquipment = function openEquipment(equipmentId = '') {
    const existing = state.equipment.find(item => item.id === equipmentId);
    openModal(existing ? 'Editar equipamento' : 'Novo equipamento', `
      <form id="equipmentForm">
        <div class="form-grid">
          <div class="form-group full"><label>Nome</label><input id="eqName" required value="${escapeHtml(existing?.name || '')}"></div>
          <div class="form-group"><label>Categoria</label><select id="eqCategory" required><option value="Construção" ${existing?.category === 'Construção' ? 'selected' : ''}>Construção</option><option value="Limpeza" ${existing?.category === 'Limpeza' ? 'selected' : ''}>Limpeza</option><option value="Jardinagem" ${existing?.category === 'Jardinagem' ? 'selected' : ''}>Jardinagem</option><option value="Pintura" ${existing?.category === 'Pintura' ? 'selected' : ''}>Pintura</option></select></div>
          <div class="form-group"><label>Nº patrimônio / série</label><input id="eqSerial" required value="${escapeHtml(existing?.serial || '')}"></div>
          <div class="form-group"><label>Quantidade em estoque</label><input id="eqTotal" type="number" min="0" required value="${existing?.total ?? 1}"></div>
          <div class="form-group"><label>Status</label><select id="eqStatus"><option value="disponivel" ${existing?.status === 'disponivel' ? 'selected' : ''}>Disponível</option><option value="manutencao" ${existing?.status === 'manutencao' ? 'selected' : ''}>Manutenção</option><option value="indisponivel" ${existing?.status === 'indisponivel' ? 'selected' : ''}>Indisponível</option></select></div>
          <div class="form-group"><label>Preço por diária</label><input id="eqDaily" type="number" min="0" step="0.01" value="${existing?.daily ?? 0}" required></div>
          <div class="form-group"><label>Caução</label><input id="eqDeposit" type="number" min="0" step="0.01" value="${existing?.deposit ?? 0}"></div>
          <div class="form-group"><label>Próxima revisão</label><input id="eqReview" type="date" required value="${escapeHtml(existing?.nextReview || offsetDate(30))}"></div>
          <div class="form-group"><label>Potência / material</label><input id="eqPower" value="${escapeHtml(existing?.power || '')}"></div>
          <div class="form-group"><label>Peso</label><input id="eqWeight" value="${escapeHtml(existing?.weight || '')}"></div>
          <div class="form-group full"><label>Acessórios (separados por vírgula)</label><input id="eqAccessories" value="${escapeHtml(existing?.accessories?.join(', ') || '')}"></div>
          <div class="form-group full"><label>Caminho da imagem</label><input id="eqImage" value="${escapeHtml(existing?.image || 'assets/photos/ferramentas.jpg')}"></div>
          <div class="form-group full"><label>Descrição</label><textarea id="eqDescription">${escapeHtml(existing?.description || '')}</textarea></div>
        </div>
        <button class="btn btn-primary btn-block" style="margin-top:18px">Salvar equipamento no banco</button>
      </form>`);

    document.getElementById('equipmentForm').addEventListener('submit', async event => {
      event.preventDefault();
      const payload = {
        name: val('eqName'), category: val('eqCategory'), serial: val('eqSerial'),
        total: Number(val('eqTotal')), status: val('eqStatus'), daily: Number(val('eqDaily')),
        deposit: Number(val('eqDeposit')), nextReview: val('eqReview'), power: val('eqPower'),
        weight: val('eqWeight'), accessories: val('eqAccessories'), image: val('eqImage'), description: val('eqDescription')
      };
      try {
        await api(existing ? `/api/admin/equipment/${encodeURIComponent(existing.id)}` : '/api/admin/equipment', {
          method: existing ? 'PUT' : 'POST', body: JSON.stringify(payload)
        });
        closeModal();
        showToast('Equipamento registrado com sucesso.');
        await renderAll();
      } catch (error) {
        handleAdminError(error);
      }
    });
  };

  function renderMaintenance() {
    document.getElementById('maintenanceCards').innerHTML = state.equipment.map(item => {
      const info = reviewInfo(item);
      const badge = info.due ? 'danger' : info.soon ? 'warning' : 'success';
      const text = info.due ? `Vencida há ${Math.abs(info.days)} dia(s)` : info.soon ? `Programada em ${info.days} dia(s)` : `Em dia — faltam ${info.days} dias`;
      return `<div class="maintenance-card"><span class="badge ${badge}">${text}</span><h3>${escapeHtml(item.name)}</h3><p>Patrimônio: ${escapeHtml(item.serial)}<br>Data: ${new Date(`${item.nextReview}T12:00:00`).toLocaleDateString('pt-BR')}</p><div class="progress"><span style="width:${Math.max(5, Math.min(100, 100 - info.days))}%"></span></div><button class="btn btn-outline btn-sm" style="margin-top:14px" onclick="openMaintenance('${escapeHtml(item.id)}')">Registrar revisão</button></div>`;
    }).join('');

    document.getElementById('maintenanceTable').innerHTML = state.maintenance.length
      ? tableHtml(['Data', 'Equipamento', 'Serviço', 'Peças / observações', 'Próxima revisão'], state.maintenance.map(item => [
          new Date(`${item.date}T12:00:00`).toLocaleDateString('pt-BR'), escapeHtml(item.equipmentName), escapeHtml(item.service), escapeHtml(item.notes || '-'), new Date(`${item.nextReview}T12:00:00`).toLocaleDateString('pt-BR')
        ]))
      : empty('Nenhuma manutenção registrada.');
  }

  document.getElementById('newMaintenanceButton').addEventListener('click', () => openMaintenance());

  window.openMaintenance = function openMaintenance(equipmentId = '') {
    openModal('Registrar manutenção / revisão', `<form id="maintenanceForm"><div class="form-grid">
      <div class="form-group full"><label>Equipamento</label><select id="mntEquipment" required><option value="">Selecione...</option>${state.equipment.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === equipmentId ? 'selected' : ''}>${escapeHtml(item.name)} — ${escapeHtml(item.serial)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Data do serviço</label><input id="mntDate" type="date" value="${new Date().toISOString().slice(0, 10)}" required></div>
      <div class="form-group"><label>Próxima revisão</label><input id="mntNext" type="date" value="${offsetDate(90)}" required></div>
      <div class="form-group full"><label>Serviço realizado</label><input id="mntService" placeholder="Ex.: troca de óleo e teste de segurança" required></div>
      <div class="form-group full"><label>Peças, checklist e observações</label><textarea id="mntNotes"></textarea></div>
      <div class="form-group"><label>Status após revisão</label><select id="mntStatus"><option value="disponivel">Liberado</option><option value="manutencao">Permanece em manutenção</option><option value="indisponivel">Indisponível</option></select></div>
      </div><button class="btn btn-primary btn-block" style="margin-top:18px">Salvar manutenção no banco</button></form>`);

    document.getElementById('maintenanceForm').addEventListener('submit', async event => {
      event.preventDefault();
      try {
        await api('/api/admin/maintenance', {
          method: 'POST',
          body: JSON.stringify({ equipmentId: val('mntEquipment'), date: val('mntDate'), nextReview: val('mntNext'), service: val('mntService'), notes: val('mntNotes'), statusAfter: val('mntStatus') })
        });
        closeModal();
        showToast('Manutenção registrada no banco de dados.');
        await renderAll();
      } catch (error) {
        handleAdminError(error);
      }
    });
  };

  function renderFinance() {
    const finance = state.finance;
    document.getElementById('financeCards').innerHTML = [
      ['Receita recebida', finance.received, 'Pagamentos confirmados'],
      ['Contas a receber', finance.accountsReceivable ?? finance.pending, 'Reservas com pagamento pendente'],
      ['Contas a pagar', finance.accountsPayable || 0, 'Despesas operacionais pendentes'],
      ['Ticket médio', finance.averageTicket || 0, 'Média por reserva, sem caução'],
      ['Saldo previsto', finance.expectedBalance || 0, 'Recebido + a receber - a pagar'],
      ['Garantias vinculadas', finance.deposits, 'Cauções associadas a reservas ativas'],
      ['Multas por atraso', finance.lateFees, 'Valores extras por devolução fora do prazo']
    ].map(([label, value, note]) => `<div class="finance-card"><span class="muted">${label}</span><strong>${formatMoney(value)}</strong><div class="small muted">${note}</div></div>`).join('');

    const receivableRows = finance.receivableRows || [];
    const payableRows = finance.payableRows || [];

    const receivableTarget = document.getElementById('accountsReceivableTable');
    if (receivableTarget) {
      receivableTarget.innerHTML = receivableRows.length
        ? tableHtml(['Contrato', 'Cliente', 'Vencimento', 'Valor', 'Status'], receivableRows.map(item => [
            escapeHtml(item.contract), escapeHtml(item.clientName), formatDateTime(item.dueDate), formatMoney(item.amount), paymentBadge(item.status)
          ]))
        : empty('Nenhuma conta a receber pendente.');
    }

    const payableTarget = document.getElementById('accountsPayableTable');
    if (payableTarget) {
      payableTarget.innerHTML = payableRows.length
        ? tableHtml(['Descrição', 'Vencimento', 'Valor', 'Status'], payableRows.map(item => [
            `<strong>${escapeHtml(item.description)}</strong><div class="small muted">${escapeHtml(item.category)}${item.supplier ? ` · ${escapeHtml(item.supplier)}` : ''}</div>`,
            new Date(`${item.dueDate}T12:00:00`).toLocaleDateString('pt-BR'),
            formatMoney(item.amount),
            item.status === 'pago' ? '<span class="badge success">Pago</span>' : item.status === 'cancelado' ? '<span class="badge gray">Cancelado</span>' : '<span class="badge warning">Pendente</span>'
          ]))
        : empty('Nenhuma conta a pagar cadastrada.');
    }

    document.getElementById('financeTable').innerHTML = finance.rows.length
      ? tableHtml(['Contrato', 'Cliente', 'A pagar agora', 'Garantia vinculada', 'Multa atual', 'Pagamento', 'Situação'], finance.rows.map(item => [
          escapeHtml(item.contract), escapeHtml(item.clientName), formatMoney(item.payNow || (item.rental - item.discount + item.freight)), formatMoney(item.deposit), formatMoney(item.lateFee), paymentBadge(item.paymentStatus), statusBadge(item.status)
        ]))
      : empty('Nenhum lançamento financeiro.');
  }


  function deliveryBadge(status, type = 'delivery') {
    const labels = {
      aguardando: 'Aguardando',
      em_rota: 'Em rota',
      entregue: 'Entregue',
      pendente: 'Pendente',
      agendado: 'Agendado',
      recolhido: 'Recolhido',
      cancelado: 'Cancelado'
    };
    const style = { aguardando: 'warning', em_rota: 'info', entregue: 'success', pendente: 'warning', agendado: 'info', recolhido: 'success', cancelado: 'danger' }[status] || 'gray';
    return `<span class="badge ${style}">${labels[status] || status}</span>`;
  }

  function renderDeliveries() {
    const search = (document.getElementById('deliverySearch')?.value || '').toLowerCase();
    const status = document.getElementById('deliveryStatusFilter')?.value || '';
    const deliveries = state.deliveries.filter(item => {
      const matchesSearch = `${item.contract} ${item.clientName} ${item.equipmentName} ${item.fullAddress}`.toLowerCase().includes(search);
      const matchesStatus = !status || item.deliveryStatus === status || item.pickupStatus === status;
      return matchesSearch && matchesStatus;
    });

    const totals = {
      total: state.deliveries.length,
      route: state.deliveries.filter(item => item.deliveryStatus === 'em_rota' || item.pickupStatus === 'em_rota').length,
      delivered: state.deliveries.filter(item => item.deliveryStatus === 'entregue').length,
      pickup: state.deliveries.filter(item => item.pickupStatus !== 'recolhido' && item.status === 'em_uso').length
    };
    document.getElementById('deliverySummary').innerHTML = [
      ['Entregas cadastradas', totals.total, '🗺️'],
      ['Em rota', totals.route, '🚚'],
      ['Entregues', totals.delivered, '✅'],
      ['Recolhimentos pendentes', totals.pickup, '↩️']
    ].map(([label, value, icon]) => `<div class="finance-card"><span class="muted">${label}</span><strong>${value}</strong><div class="small muted">${icon}</div></div>`).join('');

    document.getElementById('deliveryTable').innerHTML = deliveries.length
      ? tableHtml(['Contrato', 'Cliente / endereço', 'Equipamentos', 'Entrega', 'Recolhimento', 'Mapa', 'Ações'], deliveries.map(item => [
          `<strong>${escapeHtml(item.contract)}</strong><div class="small muted">${formatDateTime(item.start)} até ${formatDateTime(item.end)}</div>`,
          `${escapeHtml(item.clientName)}<div class="small muted">${escapeHtml(item.fullAddress)}</div>`,
          escapeHtml(item.equipmentName),
          `${deliveryBadge(item.deliveryStatus)}<div class="small muted">${item.scheduledAt ? `Agendada: ${formatDateTime(item.scheduledAt)}` : 'Sem horário definido'}</div>`,
          `${deliveryBadge(item.pickupStatus, 'pickup')}<div class="small muted">${item.pickupScheduledAt ? `Agendado: ${formatDateTime(item.pickupScheduledAt)}` : 'Definir após entrega'}</div>`,
          `<a class="btn btn-outline btn-sm" href="${escapeHtml(item.routeUrl)}" target="_blank" rel="noopener">Abrir rota</a>`,
          `<button class="btn btn-primary btn-sm" onclick="openDeliveryControl('${escapeHtml(item.id)}')">Controlar</button>`
        ]))
      : empty('Nenhuma entrega encontrada. As reservas só aparecem aqui quando o cliente escolhe entrega opcional.');
  }

  window.openDeliveryControl = async function openDeliveryControl(reservationId) {
    const delivery = state.deliveries.find(item => item.id === reservationId);
    if (!delivery) return;
    openModal('Controle de entrega e recolhimento', `
      <div class="delivery-modal-grid">
        <div>
          <div class="form-grid">
            <div class="form-group full"><label>Reserva</label><input value="${escapeHtml(delivery.contract)} — ${escapeHtml(delivery.clientName)}" disabled></div>
            <div class="form-group full"><label>Endereço do cliente</label><textarea disabled>${escapeHtml(delivery.fullAddress)}</textarea></div>
            <div class="form-group"><label>Status da entrega</label><select id="deliveryStatusEdit">
              <option value="aguardando" ${delivery.deliveryStatus === 'aguardando' ? 'selected' : ''}>Aguardando entrega</option>
              <option value="em_rota" ${delivery.deliveryStatus === 'em_rota' ? 'selected' : ''}>Em rota de entrega</option>
              <option value="entregue" ${delivery.deliveryStatus === 'entregue' ? 'selected' : ''}>Entregue ao cliente</option>
              <option value="cancelado" ${delivery.deliveryStatus === 'cancelado' ? 'selected' : ''}>Cancelado</option>
            </select></div>
            <div class="form-group"><label>Status do recolhimento</label><select id="pickupStatusEdit">
              <option value="pendente" ${delivery.pickupStatus === 'pendente' ? 'selected' : ''}>Pendente</option>
              <option value="agendado" ${delivery.pickupStatus === 'agendado' ? 'selected' : ''}>Agendado</option>
              <option value="em_rota" ${delivery.pickupStatus === 'em_rota' ? 'selected' : ''}>Em rota de recolhimento</option>
              <option value="recolhido" ${delivery.pickupStatus === 'recolhido' ? 'selected' : ''}>Recolhido</option>
              <option value="cancelado" ${delivery.pickupStatus === 'cancelado' ? 'selected' : ''}>Cancelado</option>
            </select></div>
            <div class="form-group"><label>Agendar entrega</label><input id="deliveryScheduledAt" type="datetime-local" value="${delivery.scheduledAt ? new Date(delivery.scheduledAt).toISOString().slice(0,16) : ''}"></div>
            <div class="form-group"><label>Agendar recolhimento</label><input id="pickupScheduledAt" type="datetime-local" value="${delivery.pickupScheduledAt ? new Date(delivery.pickupScheduledAt).toISOString().slice(0,16) : ''}"></div>
            <div class="form-group"><label>Responsável</label><input id="deliveryResponsible" value="${escapeHtml(delivery.responsibleName || state.admin?.name || '')}" placeholder="Nome do motorista/equipe"></div>
            <div class="form-group"><label>Veículo / placa</label><input id="deliveryVehicle" value="${escapeHtml(delivery.vehiclePlate)}" placeholder="Ex.: ABC1D23"></div>
            <div class="form-group full"><label>Observações da rota</label><textarea id="deliveryNotes" placeholder="Referência, portaria, contato no local, restrições de acesso...">${escapeHtml(delivery.trackingNotes)}</textarea></div>
          </div>
        </div>
        <div class="delivery-map-card">
          <iframe src="${escapeHtml(delivery.embedMapUrl)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Mapa demonstrativo do endereço"></iframe>
          <a class="btn btn-outline btn-block" href="${escapeHtml(delivery.routeUrl)}" target="_blank" rel="noopener">Abrir rota no Google Maps</a>
          <span class="small muted">Mapa demonstrativo. A roteirização real depende de serviço externo de mapas.</span>
        </div>
      </div>
      <div class="modal-action-bar">
        <a class="btn btn-outline" href="nota-fiscal.html?id=${encodeURIComponent(delivery.id)}" target="_blank">Nota / recibo</a>
        <button class="btn btn-primary" id="saveDeliveryControl">Salvar controle</button>
      </div>
    `);
    document.getElementById('saveDeliveryControl').addEventListener('click', async () => {
      try {
        await api(`/api/admin/deliveries/${encodeURIComponent(reservationId)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            deliveryStatus: val('deliveryStatusEdit'),
            pickupStatus: val('pickupStatusEdit'),
            scheduledAt: val('deliveryScheduledAt'),
            pickupScheduledAt: val('pickupScheduledAt'),
            responsibleName: val('deliveryResponsible'),
            vehiclePlate: val('deliveryVehicle'),
            trackingNotes: val('deliveryNotes')
          })
        });
        closeModal();
        showToast('Controle de entrega atualizado.');
        await renderAll();
      } catch (error) { handleAdminError(error); }
    });
  };


  function renderAssistantAdmin() {
    const cardsElement = document.getElementById('assistantAdminCards');
    const listElement = document.getElementById('assistantAdminList');
    if (!cardsElement || !listElement) return;
    const services = state.assistant.services || [];
    const activeServices = services.filter(item => item.active).length;
    const packages = services.flatMap(item => item.packages || []);
    const activePackages = packages.filter(item => item.active).length;
    const recommendationCount = services.reduce((sum, item) => sum + (item.recommendations?.length || 0), 0);
    cardsElement.innerHTML = [
      ['Serviços ativos', activeServices, '🧭', `${services.length} serviço(s) cadastrado(s)`],
      ['Pacotes ativos', activePackages, '📦', `${packages.length} pacote(s) cadastrado(s)`],
      ['Recomendações', recommendationCount, '🧰', 'Vínculos entre serviços e equipamentos'],
      ['Desconto médio', packages.length ? `${(packages.reduce((sum, item) => sum + Number(item.discountPercent), 0) / packages.length).toFixed(1)}%` : '0%', '🏷️', 'Média dos pacotes cadastrados']
    ].map(([label, value, icon, note]) => `<div class="kpi-card"><div class="kpi-head"><span>${escapeHtml(String(label))}</span><div class="kpi-icon">${icon}</div></div><div class="kpi-value">${escapeHtml(String(value))}</div><div class="kpi-note">${escapeHtml(String(note))}</div></div>`).join('');

    listElement.innerHTML = services.map(service => `
      <article class="assistant-admin-service">
        <div class="assistant-admin-head"><div><h3>${escapeHtml(safeServiceIcon(service.icon, service.name))} ${escapeHtml(service.name)}</h3><p>${escapeHtml(service.description)} · ${escapeHtml(service.category)}</p></div><button class="btn ${service.active ? 'btn-secondary' : 'btn-outline'} btn-sm" data-service-toggle="${escapeHtml(service.id)}" data-active="${service.active ? '1' : '0'}">${service.active ? 'Ativo' : 'Desativado'}</button></div>
        <div class="assistant-admin-recommendations">${(service.recommendations || []).map(item => `<span class="spec">${escapeHtml(item.name)}</span>`).join('')}</div>
        <div class="assistant-admin-packages">${(service.packages || []).length ? service.packages.map(pack => `
          <div class="assistant-admin-package"><div><strong>${escapeHtml(pack.name)}</strong><div class="small muted">${pack.items.map(item => `${item.quantity}x ${escapeHtml(item.name)}`).join(' · ')}</div></div><label class="small">Desconto %<input type="number" min="0" max="30" step="0.5" value="${Number(pack.discountPercent)}" data-package-discount="${escapeHtml(pack.id)}"></label><button class="btn ${pack.active ? 'btn-secondary' : 'btn-outline'} btn-sm" data-package-toggle="${escapeHtml(pack.id)}" data-active="${pack.active ? '1' : '0'}">${pack.active ? 'Ativo' : 'Desativado'}</button></div>`).join('') : '<span class="small muted">Nenhum pacote cadastrado para este serviço.</span>'}</div>
      </article>`).join('');

    document.querySelectorAll('[data-service-toggle]').forEach(button => button.addEventListener('click', async () => {
      try {
        await api(`/api/admin/assistant/services/${encodeURIComponent(button.dataset.serviceToggle)}`, { method: 'PATCH', body: JSON.stringify({ active: button.dataset.active !== '1' }) });
        showToast('Serviço atualizado.'); await renderAll();
      } catch (error) { handleAdminError(error); }
    }));
    document.querySelectorAll('[data-package-toggle]').forEach(button => button.addEventListener('click', async () => {
      const input = document.querySelector(`[data-package-discount="${CSS.escape(button.dataset.packageToggle)}"]`);
      try {
        await api(`/api/admin/assistant/packages/${encodeURIComponent(button.dataset.packageToggle)}`, { method: 'PATCH', body: JSON.stringify({ active: button.dataset.active !== '1', discountPercent: Number(input?.value || 0) }) });
        showToast('Pacote atualizado.'); await renderAll();
      } catch (error) { handleAdminError(error); }
    }));
    document.querySelectorAll('[data-package-discount]').forEach(input => input.addEventListener('change', async () => {
      const pack = packages.find(item => item.id === input.dataset.packageDiscount);
      try {
        await api(`/api/admin/assistant/packages/${encodeURIComponent(input.dataset.packageDiscount)}`, { method: 'PATCH', body: JSON.stringify({ active: pack?.active !== false, discountPercent: Number(input.value || 0) }) });
        showToast('Desconto do pacote atualizado.'); await renderAll();
      } catch (error) { handleAdminError(error); }
    }));
  }

  function renderLoyalty() {
    const loyalty = state.loyalty;
    document.getElementById('loyaltyCards').innerHTML = [
      ['Pontos distribuídos', loyalty.distributedPoints, '★', 'Pontos concedidos em locações concluídas'],
      ['Clientes pontuados', loyalty.rewardedClients, '👥', 'Clientes que já receberam pontos'],
      ['Cupons ativos', loyalty.activeCoupons, '🏷️', 'Cupons de 10% disponíveis'],
      ['Melhor cliente', loyalty.topClients[0]?.name || '-', '🏆', loyalty.topClients[0] ? `${loyalty.topClients[0].points} pontos · ${loyalty.topClients[0].level}` : 'Nenhum cliente pontuado']
    ].map(([label, value, icon, note]) => `<div class="kpi-card"><div class="kpi-head"><span>${escapeHtml(String(label))}</span><div class="kpi-icon">${icon}</div></div><div class="kpi-value">${escapeHtml(String(value))}</div><div class="kpi-note">${escapeHtml(String(note))}</div></div>`).join('');

    const rows = loyalty.clients.map(client => [
      `<strong>${escapeHtml(client.name)}</strong><div class="small muted">${escapeHtml(client.cpf)} · ${escapeHtml(client.phone)}</div>`,
      `<span class="badge ${client.level === 'Obra Premium' || client.level === 'Ouro' ? 'success' : client.level === 'Prata' ? 'info' : 'gray'}">${escapeHtml(client.level)}</span>`,
      `<strong>${client.points}</strong>`,
      String(client.completedRentals),
      client.activeCoupons ? `<span class="badge success">${client.activeCoupons} ativo(s)</span>` : '<span class="muted">Nenhum</span>'
    ]);
    document.getElementById('loyaltyTable').innerHTML = rows.length
      ? tableHtml(['Cliente', 'Nível', 'Pontos', 'Locações concluídas', 'Cupons'], rows)
      : empty('Nenhum cliente cadastrado no programa.');
  }


  function monthlyRevenueData(reservations) {
    const formatter = new Intl.DateTimeFormat('pt-BR', { month: 'short' });
    const now = new Date();
    const months = [];
    for (let offset = 5; offset >= 0; offset -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      months.push({ key, label: formatter.format(date).replace('.', ''), value: 0 });
    }
    reservations.forEach(item => {
      if (item.status === 'cancelada' || item.paymentStatus !== 'pago') return;
      const date = new Date(item.start);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const month = months.find(entry => entry.key === key);
      if (month) month.value += Number(item.rental || 0) + Number(item.freight || 0);
    });
    return months.map(item => ({ label: item.label, value: Number(item.value.toFixed(2)) }));
  }

  function topEquipmentData(reservations) {
    const counts = new Map();
    reservations.forEach(item => {
      if (item.status === 'cancelada') return;
      counts.set(item.equipmentName, (counts.get(item.equipmentName) || 0) + Number(item.quantity || 1));
    });
    return [...counts.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }

  function buildHorizontalBarsHtml(items, options = {}) {
    const validItems = items.filter(item => Number(item.value) > 0);
    if (!validItems.length) return empty(options.emptyText || 'Sem dados para exibir.');
    const max = Math.max(...validItems.map(item => Number(item.value)));
    return `<div class="metric-bars">${validItems.map(item => {
      const width = max ? Math.max(8, Number(item.value) / max * 100) : 0;
      const valueText = options.currency ? formatMoney(item.value) : escapeHtml(String(item.value));
      return `<div class="metric-bar-row"><div class="metric-bar-head"><span>${escapeHtml(item.label)}</span><strong>${valueText}</strong></div><div class="metric-bar-track"><span style="width:${width}%"></span></div></div>`;
    }).join('')}</div>`;
  }

  function buildVerticalBarsHtml(items, options = {}) {
    const validItems = items.filter(item => Number(item.value) >= 0);
    if (!validItems.length) return empty(options.emptyText || 'Sem dados para exibir.');
    const max = Math.max(...validItems.map(item => Number(item.value)), 1);
    return `<div class="vertical-bars">${validItems.map(item => {
      const height = Math.max(10, Number(item.value) / max * 100);
      const valueText = options.currency ? formatMoney(item.value) : escapeHtml(String(item.value));
      return `<div class="vertical-bar-item"><div class="vertical-bar-value">${valueText}</div><div class="vertical-bar-track"><span style="height:${height}%"></span></div><div class="vertical-bar-label">${escapeHtml(item.label)}</div></div>`;
    }).join('')}</div>`;
  }

  function upcomingSchedule(reservations, activeCount) {
    const list = reservations
      .filter(item => ['pendente', 'confirmada', 'em_uso'].includes(item.status))
      .sort((a, b) => new Date(a.start) - new Date(b.start))
      .slice(0, 6);
    if (!list.length) return empty('Não há retiradas ou devoluções próximas.');
    return `<div class="schedule-board"><div class="schedule-summary"><strong>${activeCount}</strong><span>locação(ões) em andamento</span></div>${list.map(item => `<div class="schedule-item"><div><strong>${escapeHtml(item.clientName)}</strong><div class="small muted">${escapeHtml(item.equipmentName)}</div></div><div class="schedule-dates"><span>Retirada: ${formatDateTime(item.start)}</span><span>Devolução: ${formatDateTime(item.end)}</span></div></div>`).join('')}</div>`;
  }


  function renderNotifications() {
    const items = [
      ...(state.dashboard?.alerts || []).map(item => ({ ...item, message: item.detail })),
      ...(state.dashboard?.reviews || []).slice(0, 5).map(item => {
        const info = reviewInfo(item);
        return { type: info.due ? 'danger' : 'warning', title: `Revisão: ${item.name}`, message: info.due ? `Vencida há ${Math.abs(info.days)} dia(s).` : `Vence em ${info.days} dia(s).`, equipmentId: item.id };
      })
    ];
    document.getElementById('notificationCount').textContent = items.length;
    document.getElementById('notificationCount').classList.toggle('hidden', !items.length);
    document.getElementById('notificationList').innerHTML = items.length ? items.map(item => `<button class="notification-item ${item.type || 'info'}" type="button" ${item.reservationId ? `data-notification-reservation="${escapeHtml(item.reservationId)}"` : item.equipmentId ? `data-notification-equipment="${escapeHtml(item.equipmentId)}"` : ''}><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.message || '')}</span></button>`).join('') : empty('Nenhuma notificação no momento.');
    document.querySelectorAll('[data-notification-reservation]').forEach(button => button.addEventListener('click', () => { document.getElementById('notificationMenu').classList.add('hidden'); openReservation(button.dataset.notificationReservation); }));
    document.querySelectorAll('[data-notification-equipment]').forEach(button => button.addEventListener('click', () => { document.getElementById('notificationMenu').classList.add('hidden'); openMaintenance(button.dataset.notificationEquipment); }));
  }

  document.getElementById('notificationButton').addEventListener('click', () => document.getElementById('notificationMenu').classList.toggle('hidden'));
  document.getElementById('closeNotificationMenu').addEventListener('click', () => document.getElementById('notificationMenu').classList.add('hidden'));

  function renderCalendar() {
    const date = state.calendarDate;
    document.getElementById('calendarTitle').textContent = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    const first = new Date(date.getFullYear(), date.getMonth(), 1);
    const start = new Date(first); start.setDate(1 - first.getDay());
    const todayKey = new Date().toISOString().slice(0, 10);
    const cells = [];
    for (let index = 0; index < 42; index += 1) {
      const day = new Date(start); day.setDate(start.getDate() + index);
      const key = day.toISOString().slice(0, 10);
      const dayStart = new Date(`${key}T00:00:00`); const dayEnd = new Date(`${key}T23:59:59`);
      const events = state.reservations.filter(item => item.status !== 'cancelada' && new Date(item.start) <= dayEnd && new Date(item.end) >= dayStart);
      const eventHtml = events.slice(0, 3).map(item => {
        const late = item.status === 'em_uso' && new Date(item.end) < new Date();
        const cls = late ? 'late' : item.status === 'pendente' ? 'pending' : item.status === 'confirmada' ? 'confirmed' : item.status === 'em_uso' ? 'using' : 'done';
        return `<button class="calendar-event ${cls}" data-calendar-reservation="${escapeHtml(item.id)}" title="${escapeHtml(item.clientName)} · ${escapeHtml(item.equipmentName)}"><strong>${escapeHtml(item.contract)}</strong><span>${escapeHtml(item.clientName)}</span></button>`;
      }).join('');
      cells.push(`<div class="calendar-day ${day.getMonth() !== date.getMonth() ? 'outside' : ''} ${key === todayKey ? 'today' : ''}"><div class="calendar-day-number">${day.getDate()}</div><div class="calendar-events">${eventHtml}${events.length > 3 ? `<span class="calendar-more">+${events.length - 3} reserva(s)</span>` : ''}</div></div>`);
    }
    document.getElementById('reservationCalendar').innerHTML = cells.join('');
    document.querySelectorAll('[data-calendar-reservation]').forEach(button => button.addEventListener('click', () => openReservation(button.dataset.calendarReservation)));
  }

  document.getElementById('calendarPrev').addEventListener('click', () => { state.calendarDate.setMonth(state.calendarDate.getMonth() - 1); renderCalendar(); });
  document.getElementById('calendarNext').addEventListener('click', () => { state.calendarDate.setMonth(state.calendarDate.getMonth() + 1); renderCalendar(); });
  document.getElementById('calendarToday').addEventListener('click', () => { state.calendarDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1); renderCalendar(); });

  function renderAssets() {
    const search = (document.getElementById('assetSearch')?.value || '').toLowerCase();
    const status = document.getElementById('assetStatusFilter')?.value || '';
    const units = state.units.filter(unit => (!status || unit.status === status) && `${unit.assetCode} ${unit.serialNumber || ''} ${unit.equipmentName} ${unit.clientName || ''} ${unit.contract || ''}`.toLowerCase().includes(search));
    const counts = ['disponivel','em_uso','manutencao','indisponivel'].map(key => [key, state.units.filter(item => item.status === key).length]);
    document.getElementById('assetSummary').innerHTML = counts.map(([key, value]) => `<div><span>${statusBadge(key)}</span><strong>${value}</strong></div>`).join('');
    const rows = units.map(unit => [
      `<strong>${escapeHtml(unit.assetCode)}</strong><div class="small muted">${escapeHtml(unit.serialNumber || '-')}</div>`,
      `<strong>${escapeHtml(unit.equipmentName)}</strong><div class="small muted">${escapeHtml(unit.category)}</div>`, statusBadge(unit.status),
      unit.contract ? `<strong>${escapeHtml(unit.contract)}</strong><div class="small muted">${escapeHtml(unit.clientName || '')}</div>` : '<span class="muted">Sem reserva ativa</span>',
      new Date(`${unit.nextReview}T12:00:00`).toLocaleDateString('pt-BR'),
      `<button class="btn btn-outline btn-sm" onclick="openAsset('${escapeHtml(unit.id)}')">Editar</button>`
    ]);
    document.getElementById('assetsTable').innerHTML = rows.length ? tableHtml(['Patrimônio','Equipamento','Situação','Reserva atual','Próxima revisão','Ação'], rows) : empty('Nenhuma unidade patrimonial encontrada.');
  }

  document.getElementById('assetSearch').addEventListener('input', renderAssets);
  document.getElementById('assetStatusFilter').addEventListener('change', renderAssets);

  window.openAsset = function openAsset(unitId) {
    const unit = state.units.find(item => item.id === unitId); if (!unit) return;
    openModal('Editar unidade patrimonial', `<form id="assetForm"><div class="form-grid">
      <div class="form-group"><label>Código patrimonial</label><input value="${escapeHtml(unit.assetCode)}" disabled></div>
      <div class="form-group"><label>Número de série</label><input id="assetSerial" value="${escapeHtml(unit.serialNumber || '')}"></div>
      <div class="form-group"><label>Status</label><select id="assetStatus"><option value="disponivel" ${unit.status === 'disponivel' ? 'selected' : ''}>Disponível</option><option value="em_uso" ${unit.status === 'em_uso' ? 'selected' : ''}>Em uso</option><option value="manutencao" ${unit.status === 'manutencao' ? 'selected' : ''}>Manutenção</option><option value="indisponivel" ${unit.status === 'indisponivel' ? 'selected' : ''}>Indisponível</option></select></div>
      <div class="form-group"><label>Próxima revisão</label><input id="assetReview" type="date" value="${escapeHtml(unit.nextReview)}"></div>
      <div class="form-group full"><label>Observações</label><textarea id="assetNotes">${escapeHtml(unit.notes || '')}</textarea></div>
      </div><button class="btn btn-primary btn-block" style="margin-top:18px">Salvar unidade</button></form>`);
    document.getElementById('assetForm').addEventListener('submit', async event => { event.preventDefault(); try { await api(`/api/admin/units/${encodeURIComponent(unitId)}`, { method: 'PATCH', body: JSON.stringify({ serialNumber: val('assetSerial'), status: val('assetStatus'), nextReview: val('assetReview'), notes: val('assetNotes') }) }); closeModal(); showToast('Unidade patrimonial atualizada.'); await renderAll(); } catch (error) { handleAdminError(error); } });
  };

  function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
  function downloadCsv(name, headers, rows) {
    const csv = '\ufeff' + [headers, ...rows].map(row => row.map(csvCell).join(';')).join('\n');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); link.download = `${name}-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(link.href);
  }
  function exportReport(type) {
    if (type === 'reservations') downloadCsv('reservas', ['Contrato','Cliente','Equipamentos','Retirada','Devolução','Status','Pagamento','A pagar agora','Garantia vinculada'], state.reservations.map(r => [r.contract,r.clientName,r.equipmentName,formatDateTime(r.start),formatDateTime(r.end),r.status,r.paymentStatus,r.payNow || r.total,r.deposit]));
    if (type === 'clients') downloadCsv('clientes', ['Nome','Tipo','Documento','E-mail','Telefone','Cidade','Reservas','Total pago'], state.clients.map(c => [c.name,c.clientType,c.document,c.email,c.phone,`${c.city}-${c.state}`,c.reservations,c.totalPaid]));
    if (type === 'equipment') downloadCsv('equipamentos', ['Equipamento','Categoria','Estoque','Diária','Status','Próxima revisão'], state.equipment.map(e => [e.name,e.category,e.total,e.daily,e.status,e.nextReview]));
    if (type === 'assets') downloadCsv('patrimonio', ['Patrimônio','Equipamento','Série','Status','Contrato atual','Cliente','Próxima revisão'], state.units.map(u => [u.assetCode,u.equipmentName,u.serialNumber,u.status,u.contract || '',u.clientName || '',u.nextReview]));
    if (type === 'finance') downloadCsv('financeiro', ['Contrato','Cliente','A pagar agora','Garantia vinculada','Multa','Pagamento','Status'], state.finance.rows.map(r => [r.contract,r.clientName,r.payNow || (r.rental - r.discount + r.freight),r.deposit,r.lateFee,r.paymentStatus,r.status]));
    if (type === 'deliveries') downloadCsv('entregas', ['Contrato','Cliente','Endereço','Entrega','Recolhimento','Responsável','Veículo'], state.deliveries.map(d => [d.contract,d.clientName,d.fullAddress,d.deliveryStatusLabel,d.pickupStatusLabel,d.responsibleName,d.vehiclePlate]));
  }
  document.querySelectorAll('[data-export]').forEach(button => button.addEventListener('click', () => exportReport(button.dataset.export)));


  function goalMetricLabel(metric) {
    return { revenue: 'Receita', reservations: 'Reservas', clients: 'Novos clientes', on_time_rate: 'Pontualidade' }[metric] || metric;
  }

  function goalValue(metric, value) {
    if (metric === 'revenue') return formatMoney(value);
    if (metric === 'on_time_rate') return `${Number(value).toFixed(1)}%`;
    return String(Math.round(Number(value)));
  }

  function renderGoals() {
    const goals = state.goals || [];
    const achieved = goals.filter(goal => goal.progress >= 100).length;
    const average = goals.length ? goals.reduce((sum, goal) => sum + goal.progress, 0) / goals.length : 0;
    document.getElementById('goalSummary').innerHTML = [
      ['Metas ativas', goals.length, '🎯', 'Objetivos cadastrados'],
      ['Concluídas', achieved, '✅', 'Metas que chegaram a 100%'],
      ['Progresso médio', `${average.toFixed(1)}%`, '📈', 'Média de todas as metas'],
      ['Próxima meta', goals.find(goal => goal.progress < 100)?.title || '-', '🏁', 'Objetivo em andamento']
    ].map(([label,value,icon,note]) => `<div class="kpi-card"><div class="kpi-head"><span>${escapeHtml(String(label))}</span><div class="kpi-icon">${icon}</div></div><div class="kpi-value">${escapeHtml(String(value))}</div><div class="kpi-note">${escapeHtml(String(note))}</div></div>`).join('');

    document.getElementById('goalsList').innerHTML = goals.length ? `<div class="goals-grid">${goals.map(goal => `<article class="goal-card"><div class="goal-card-head"><div><span class="badge ${goal.progress >= 100 ? 'success' : 'info'}">${escapeHtml(goalMetricLabel(goal.metric))}</span><h3>${escapeHtml(goal.title)}</h3><p>${escapeHtml(goal.period_month)}</p></div><button class="btn btn-danger btn-sm" type="button" onclick="deleteGoal('${escapeHtml(goal.id)}')">Excluir</button></div><div class="goal-values"><strong>${goalValue(goal.metric, goal.currentValue)}</strong><span>de ${goalValue(goal.metric, goal.targetValue)}</span></div><div class="goal-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${goal.progress}"><span style="width:${goal.progress}%"></span></div><div class="small muted">${goal.progress}% concluído</div></article>`).join('')}</div>` : empty('Nenhuma meta cadastrada.');
  }

  document.getElementById('newGoalButton')?.addEventListener('click', () => {
    const month = new Date().toISOString().slice(0,7);
    openModal('Nova meta mensal', `<form id="goalForm"><div class="form-grid"><div class="form-group full"><label for="goalTitle">Nome da meta</label><input id="goalTitle" required placeholder="Ex.: Aumentar receita mensal"></div><div class="form-group"><label for="goalMetric">Indicador</label><select id="goalMetric"><option value="revenue">Receita recebida</option><option value="reservations">Reservas realizadas</option><option value="clients">Novos clientes</option><option value="on_time_rate">Devoluções pontuais (%)</option></select></div><div class="form-group"><label for="goalTarget">Valor desejado</label><input id="goalTarget" type="number" min="1" step="0.01" required></div><div class="form-group full"><label for="goalMonth">Mês de referência</label><input id="goalMonth" type="month" value="${month}" required></div></div><button class="btn btn-primary btn-block" style="margin-top:18px">Salvar meta</button></form>`);
    document.getElementById('goalForm').addEventListener('submit', async event => {
      event.preventDefault();
      try {
        await api('/api/admin/goals', { method: 'POST', body: JSON.stringify({ title: val('goalTitle'), metric: val('goalMetric'), targetValue: Number(val('goalTarget')), periodMonth: val('goalMonth') }) });
        closeModal(); showToast('Meta cadastrada.'); await renderAll();
      } catch (error) { handleAdminError(error); }
    });
  });

  window.deleteGoal = async function deleteGoal(goalId) {
    if (!window.confirm('Excluir esta meta?')) return;
    try { await api(`/api/admin/goals/${encodeURIComponent(goalId)}`, { method: 'DELETE' }); showToast('Meta excluída.'); await renderAll(); }
    catch (error) { handleAdminError(error); }
  };

  function tableHtml(headers, rows) {
    return `<div class="table-wrap"><table><thead><tr>${headers.map(header => `<th>${header}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function empty(text) {
    return `<div class="empty-state">${escapeHtml(text)}</div>`;
  }

  function val(id) {
    return document.getElementById(id).value.trim();
  }

  function openModal(title, body) {
    document.getElementById('adminModalTitle').textContent = title;
    document.getElementById('adminModalBody').innerHTML = body;
    adminModal.classList.remove('hidden');
    applyMasks(document.getElementById('adminModalBody'));
  }

  window.closeModal = function closeModal() {
    adminModal.classList.add('hidden');
  };

  document.getElementById('closeAdminModal').addEventListener('click', closeModal);
  adminModal.addEventListener('click', event => { if (event.target === adminModal) closeModal(); });

  function handleAdminError(error) {
    if (error.status === 401) {
      showLogin();
      showToast('Sua sessão expirou. Entre novamente.', 'error');
      return;
    }
    showToast(error.message, 'error');
  }

  async function renderAll() {
    try {
      const [dashboard, equipment, reservations, maintenance, finance, loyalty, clients, units, goals, deliveries] = await Promise.all([
        api('/api/admin/dashboard'),
        api('/api/admin/equipment'),
        api('/api/admin/reservations'),
        api('/api/admin/maintenance'),
        api('/api/admin/finance'),
        api('/api/admin/loyalty'),
        api('/api/admin/clients'),
        api('/api/admin/units'),
        api('/api/admin/goals'),
        api('/api/admin/deliveries')
      ]);
      Object.assign(state, { dashboard, equipment, reservations, maintenance, finance, loyalty, assistant: { services: [] }, clients, units, goals, deliveries });
      renderDashboard();
      renderReservations();
      renderCalendar();
      renderClients();
      renderEquipment();
      renderAssets();
      renderMaintenance();
      renderFinance();
      renderDeliveries();
      renderLoyalty();
      renderGoals();
    } catch (error) {
      handleAdminError(error);
    }
  }

  async function init() {
    try {
      const admin = await api('/api/auth/me');
      await openApp(admin);
    } catch {
      showLogin();
    }
  }

  init();
})();
