(() => {
  'use strict';

  const { api, formatMoney, applyMasks, showToast, onlyDigits, escapeHtml } = window.CasaMateriais;
  applyMasks();

  const state = { equipment: [], assistantServices: [], cart: [], selectedPackage: null, selectedServiceId: '', lastReservation: null, loyalty: null, currentClient: null, activeCategory: 'construcao', catalogSearch: '' };
  const equipmentSelect = document.getElementById('equipmentSelect');
  const accessorySelect = document.getElementById('accessorySelect');
  const bookingForm = document.getElementById('bookingForm');
  const contractModal = document.getElementById('contractModal');
  const cepInput = document.getElementById('clientCep');
  const cpfInput = document.getElementById('clientCpf');
  const couponInput = document.getElementById('couponCode');
  const loyaltyClientCard = document.getElementById('loyaltyClientCard');
  const addressInput = document.getElementById('clientAddress');
  const neighborhoodInput = document.getElementById('clientNeighborhood');
  const cityInput = document.getElementById('clientCity');
  const stateInput = document.getElementById('clientState');
  const complementInput = document.getElementById('clientComplement');
  const numberInput = document.getElementById('clientNumber');
  const cepStatus = document.getElementById('cepStatus');
  const rentalCart = document.getElementById('rentalCart');
  const selectedPackageBox = document.getElementById('selectedPackage');
  const addEquipmentButton = document.getElementById('addEquipmentButton');
  let lastSearchedCep = '';
  let cepRequestController = null;

  function setCepStatus(message, type = '') {
    cepStatus.textContent = message;
    cepStatus.className = `field-status ${type}`.trim();
  }

  function safeServiceIcon(icon, serviceName = '') {
    const value = String(icon || '').trim();
    const name = String(serviceName || '').toLowerCase();
    const unsupported = new Set(['🪚', '🪜']);
    if (!value || unsupported.has(value)) {
      if (name.includes('madeira') || name.includes('estrutura')) return '🪚';
      if (name.includes('altura')) return '🪜';
      if (name.includes('limpeza') || name.includes('pós-obra')) return '🧹';
      return '🧰';
    }
    return value;
  }

  function setAddressLoading(isLoading) {
    [addressInput, neighborhoodInput, cityInput, stateInput].forEach(input => {
      input.classList.toggle('address-loading', isLoading);
      input.setAttribute('aria-busy', String(isLoading));
    });
  }

  async function searchAddressByCep(force = false) {
    const cep = onlyDigits(cepInput.value);
    if (!cep) {
      lastSearchedCep = '';
      setCepStatus('Digite os 8 números do CEP.');
      return;
    }
    if (cep.length !== 8) {
      if (force) setCepStatus('CEP incompleto. Digite 8 números.', 'error');
      return;
    }
    if (!force && cep === lastSearchedCep) return;
    lastSearchedCep = cep;

    if (cepRequestController) cepRequestController.abort();
    cepRequestController = new AbortController();
    const timeout = setTimeout(() => cepRequestController.abort(), 8000);
    setAddressLoading(true);
    setCepStatus('Buscando endereço...', 'loading');

    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
        headers: { Accept: 'application/json' },
        signal: cepRequestController.signal
      });
      if (!response.ok) throw new Error('Falha na consulta');
      const data = await response.json();
      if (data.erro) {
        setCepStatus('CEP não encontrado. Confira os números.', 'error');
        return;
      }
      addressInput.value = data.logradouro || '';
      neighborhoodInput.value = data.bairro || '';
      cityInput.value = data.localidade || '';
      stateInput.value = (data.uf || '').toUpperCase();
      setCepStatus(data.logradouro ? 'Endereço preenchido automaticamente.' : 'CEP localizado. Complete o nome da rua.', 'success');
      (data.logradouro ? numberInput : addressInput).focus();
    } catch (error) {
      setCepStatus(
        error.name === 'AbortError'
          ? 'A consulta demorou demais. Tente novamente.'
          : 'Não foi possível consultar o CEP. Preencha manualmente.',
        'error'
      );
    } finally {
      clearTimeout(timeout);
      setAddressLoading(false);
    }
  }

  cepInput.addEventListener('input', () => {
    const cep = onlyDigits(cepInput.value);
    if (cep.length < 8) {
      lastSearchedCep = '';
      setCepStatus(cep.length ? `Faltam ${8 - cep.length} número(s).` : 'Digite os 8 números do CEP.');
      return;
    }
    searchAddressByCep();
  });
  cepInput.addEventListener('blur', () => searchAddressByCep(true));
  stateInput.addEventListener('input', event => {
    event.target.value = event.target.value.replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase();
  });

  function renderLoyaltyCard(data = null) {
    if (!data) {
      loyaltyClientCard.innerHTML = '<div class="loyalty-client-icon">★</div><div><strong>Programa ObraFácil</strong><p>Digite seu CPF para consultar pontos, nível e cupons disponíveis.</p></div>';
      return;
    }
    if (!data.registered) {
      loyaltyClientCard.innerHTML = '<div class="loyalty-client-icon">★</div><div><strong>Comece no nível Bronze</strong><p>Este CPF ainda não possui locações concluídas. A primeira locação já começa a gerar pontos.</p></div>';
      return;
    }
    const targetText = data.nextLevelPoints
      ? `Faltam ${data.pointsToNextLevel} ponto(s) para o próximo nível.`
      : 'Você alcançou o nível máximo.';
    const couponButtons = (data.coupons || []).length
      ? `<div class="loyalty-coupons">${data.coupons.map(coupon => `<button type="button" class="coupon-chip" data-coupon="${escapeHtml(coupon.code)}">${escapeHtml(coupon.code)} · ${coupon.discountPercent}% OFF</button>`).join('')}</div>`
      : '<span class="small muted">Nenhum cupom ativo. A cada 5 locações concluídas você recebe 10% OFF.</span>';
    loyaltyClientCard.innerHTML = `<div class="loyalty-client-icon">★</div><div class="loyalty-client-content"><div class="loyalty-client-title"><strong>${escapeHtml(data.level)}</strong><span>${data.points} pontos</span></div><p>${data.completedRentals} locação(ões) concluída(s). ${escapeHtml(targetText)}</p>${couponButtons}</div>`;
    loyaltyClientCard.querySelectorAll('[data-coupon]').forEach(button => button.addEventListener('click', () => {
      couponInput.value = button.dataset.coupon;
      updateEstimate();
      showToast('Cupom ObraFácil selecionado.');
    }));
  }

  async function loadLoyalty() {
    const client = state.currentClient || window.CasaClienteAuth?.getCurrent();
    if (client?.clientType === 'PJ') {
      state.loyalty = { registered: true, points: 0, level: 'Empresa', completedRentals: 0, coupons: [], history: [], businessDiscountPercent: 5 };
      loyaltyClientCard.innerHTML = '<div class="loyalty-client-icon">🏢</div><div><strong>Conta empresarial</strong><p>Seu CNPJ recebe 5% de desconto automático sobre a locação, além dos descontos de pacotes.</p></div>';
      updateEstimate();
      return;
    }
    const cpf = onlyDigits(cpfInput.value);
    if (cpf.length !== 11) {
      state.loyalty = null;
      renderLoyaltyCard();
      updateEstimate();
      return;
    }
    loyaltyClientCard.classList.add('loading');
    try {
      state.loyalty = await api(`/api/loyalty/${encodeURIComponent(cpf)}`);
      renderLoyaltyCard(state.loyalty);
      updateEstimate();
    } catch (error) {
      state.loyalty = null;
      renderLoyaltyCard();
      showToast(error.message, 'error');
    } finally {
      loyaltyClientCard.classList.remove('loading');
    }
  }

  let loyaltyTimer;
  cpfInput.addEventListener('input', () => {
    clearTimeout(loyaltyTimer);
    loyaltyTimer = setTimeout(loadLoyalty, 350);
  });
  cpfInput.addEventListener('blur', loadLoyalty);
  couponInput.addEventListener('input', () => {
    couponInput.value = couponInput.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 60);
    updateEstimate();
  });

  const IMAGE_VERSION = '40';
  function safeImage(image) {
    const fallback = 'assets/photos/ferramentas.jpg';
    const value = image || fallback;
    if (String(value).startsWith('assets/')) {
      return `${value}${String(value).includes('?') ? '&' : '?'}v=${IMAGE_VERSION}`;
    }
    return value;
  }

  function equipmentById(id) {
    return state.equipment.find(item => item.id === id);
  }

  function selectedEquipment() {
    return equipmentById(equipmentSelect.value);
  }

  function normalizeCatalogText(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function workCategory(item) {
    const value = normalizeCatalogText(item.category);
    if (value.includes('construcao')) return 'construcao';
    if (value.includes('limpeza')) return 'limpeza';
    if (value.includes('jardinagem')) return 'jardinagem';
    if (value.includes('pintura')) return 'pintura';
    return 'construcao';
  }

  function filteredEquipment() {
    const search = normalizeCatalogText(state.catalogSearch);
    return state.equipment.filter(item => workCategory(item) === state.activeCategory &&
      (!search || normalizeCatalogText(`${item.name} ${item.category} ${item.description} ${item.power}`).includes(search)));
  }

  function renderCategoryCounts() {
    const counts = { construcao: 0, limpeza: 0, jardinagem: 0, pintura: 0 };
    state.equipment.forEach(item => { counts[workCategory(item)] += 1; });
    document.querySelectorAll('[data-category-count]').forEach(element => {
      element.textContent = counts[element.dataset.categoryCount] || 0;
    });
  }

  function renderCatalog() {
    const catalogGrid = document.getElementById('catalogGrid');
    const items = filteredEquipment();
    const hasFilter = Boolean(state.catalogSearch.trim());
    document.getElementById('catalogCount').textContent = items.length;
    const categoryLabels = { construcao: 'Construção', jardinagem: 'Jardinagem', limpeza: 'Limpeza', pintura: 'Pintura' };
    document.getElementById('catalogActiveCategory').textContent = categoryLabels[state.activeCategory] || 'Construção';
    document.getElementById('clearCatalogFilter').classList.toggle('hidden', !hasFilter);
    renderCategoryCounts();

    if (!items.length) {
      catalogGrid.innerHTML = `<div class="empty-state catalog-empty"><div class="catalog-empty-icon">⌕</div><strong>Nenhum equipamento encontrado.</strong><p>Tente outra categoria ou termo de pesquisa.</p><button class="btn btn-outline btn-sm" type="button" data-clear-catalog>Limpar filtros</button></div>`;
      catalogGrid.querySelector('[data-clear-catalog]').addEventListener('click', clearCatalogFilters);
      return;
    }

    catalogGrid.innerHTML = items.map(item => `
      <article class="equipment-card" data-work-category="${workCategory(item)}">
        <div class="equipment-image"><img src="${escapeHtml(safeImage(item.image))}" alt="${escapeHtml(item.name)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='assets/photos/ferramentas.jpg'"></div>
        <div class="card-body">
          <span class="category-pill">${escapeHtml(item.category)}</span>
          <div class="card-title"><h3>${escapeHtml(item.name)}</h3><div class="price">${formatMoney(item.daily)}<small>/dia</small></div></div>
          <p class="equipment-description">${escapeHtml(item.description)}</p>
          <div class="specs"><span class="spec">${escapeHtml(item.power)}</span><span class="spec">${escapeHtml(item.weight)}</span></div>
          <div class="card-actions"><button class="btn btn-primary btn-sm" data-book="${escapeHtml(item.id)}">Adicionar</button><button class="btn btn-outline btn-sm" data-details="${escapeHtml(item.id)}">Detalhes</button></div>
        </div>
      </article>`).join('');

    catalogGrid.querySelectorAll('[data-book]').forEach(button => button.addEventListener('click', () => {
      addToCart(button.dataset.book, 1, '');
      document.getElementById('agendamento').scrollIntoView({ behavior: 'smooth' });
    }));
    catalogGrid.querySelectorAll('[data-details]').forEach(button => button.addEventListener('click', () => showEquipmentDetails(button.dataset.details)));
  }

  function setCatalogCategory(category) {
    state.activeCategory = category;
    state.catalogSearch = '';
    const search = document.getElementById('catalogSearch');
    if (search) search.value = '';
    document.querySelectorAll('[data-category]').forEach(button => {
      const active = button.dataset.category === category;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    renderCatalog();
  }

  function clearCatalogFilters() {
    state.catalogSearch = '';
    document.getElementById('catalogSearch').value = '';
    renderCatalog();
  }

  document.getElementById('categoryFilters').addEventListener('click', event => {
    const button = event.target.closest('[data-category]');
    if (button) setCatalogCategory(button.dataset.category);
  });
  document.getElementById('catalogSearch').addEventListener('input', event => { state.catalogSearch = event.target.value; renderCatalog(); });
  document.getElementById('clearCatalogFilter').addEventListener('click', clearCatalogFilters);

  function populateEquipment() {
    equipmentSelect.innerHTML = '<option value="">Selecione...</option>' + state.equipment
      .map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} — ${formatMoney(item.daily)}/dia</option>`).join('');
  }

  function updateAccessories() {
    const item = selectedEquipment();
    accessorySelect.innerHTML = '<option value="">Sem acessório</option>' + (item?.accessories || [])
      .map(accessory => `<option value="${escapeHtml(accessory)}">${escapeHtml(accessory)}</option>`).join('');
  }

  function addToCart(equipmentId, quantity = 1, accessory = '') {
    const equipment = equipmentById(equipmentId);
    if (!equipment) return;
    if (state.selectedPackage) {
      state.selectedPackage = null;
      state.selectedServiceId = '';
    }
    const existing = state.cart.find(item => item.equipmentId === equipmentId && item.accessory === accessory);
    if (existing) existing.quantity = Math.min(99, existing.quantity + Number(quantity));
    else state.cart.push({ equipmentId, quantity: Math.max(1, Number(quantity)), accessory });
    renderCart();
    updateEstimate();
    showToast(`${equipment.name} adicionado ao agendamento.`);
  }

  function selectPackage(pack, serviceId) {
    state.selectedPackage = pack;
    state.selectedServiceId = serviceId;
    state.cart = pack.items.map(item => ({ equipmentId: item.id, quantity: Number(item.quantity || 1), accessory: '' }));
    renderCart();
    updateEstimate();
    document.getElementById('agendamento').scrollIntoView({ behavior: 'smooth' });
    showToast(`${pack.name} selecionado com ${pack.discountPercent}% de desconto.`);
  }

  function renderCart() {
    if (state.selectedPackage) {
      selectedPackageBox.classList.remove('hidden');
      selectedPackageBox.innerHTML = `<div><strong>📦 ${escapeHtml(state.selectedPackage.name)}</strong><span>${state.selectedPackage.discountPercent}% de desconto automático</span></div><button type="button" class="btn btn-outline btn-sm" id="removePackage">Remover pacote</button>`;
      selectedPackageBox.querySelector('#removePackage').addEventListener('click', () => {
        state.selectedPackage = null;
        state.selectedServiceId = '';
        state.cart = [];
        renderCart(); updateEstimate();
      });
    } else selectedPackageBox.classList.add('hidden');

    if (!state.cart.length) {
      rentalCart.innerHTML = '<div class="cart-empty">Nenhum equipamento adicionado.</div>';
      return;
    }
    rentalCart.innerHTML = state.cart.map((cartItem, index) => {
      const item = equipmentById(cartItem.equipmentId);
      if (!item) return '';
      return `<div class="cart-item">
        <img src="${escapeHtml(safeImage(item.image))}" alt="${escapeHtml(item.name)}">
        <div class="cart-item-main"><strong>${escapeHtml(item.name)}</strong><span>${formatMoney(item.daily)}/dia${cartItem.accessory ? ` · ${escapeHtml(cartItem.accessory)}` : ''}</span></div>
        <label class="cart-quantity">Qtd.<input type="number" min="1" max="99" value="${cartItem.quantity}" data-cart-quantity="${index}" ${state.selectedPackage ? 'disabled' : ''}></label>
        <button class="cart-remove" type="button" data-cart-remove="${index}" aria-label="Remover ${escapeHtml(item.name)}">×</button>
      </div>`;
    }).join('');
    rentalCart.querySelectorAll('[data-cart-quantity]').forEach(input => input.addEventListener('change', () => {
      state.cart[Number(input.dataset.cartQuantity)].quantity = Math.max(1, Number(input.value || 1));
      updateEstimate();
    }));
    rentalCart.querySelectorAll('[data-cart-remove]').forEach(button => button.addEventListener('click', () => {
      state.cart.splice(Number(button.dataset.cartRemove), 1);
      if (state.selectedPackage) { state.selectedPackage = null; state.selectedServiceId = ''; }
      renderCart(); updateEstimate();
    }));
  }

  function renderAssistantServices() {
    const container = document.getElementById('assistantServices');
    if (!container) return;
    container.innerHTML = state.assistantServices.map(service => `
      <button type="button" class="assistant-service-card" data-service="${escapeHtml(service.id)}">
        <span class="assistant-service-icon">${escapeHtml(safeServiceIcon(service.icon, service.name))}</span>
        <span><strong>${escapeHtml(service.name)}</strong><small>${escapeHtml(service.category)}</small></span>
      </button>`).join('');
    container.querySelectorAll('[data-service]').forEach(button => button.addEventListener('click', () => selectAssistantService(button.dataset.service)));
  }

  function selectAssistantService(serviceId) {
    const service = state.assistantServices.find(item => item.id === serviceId);
    if (!service) return;
    state.selectedServiceId = serviceId;
    document.querySelectorAll('[data-service]').forEach(button => button.classList.toggle('active', button.dataset.service === serviceId));
    const packageHtml = service.packages.length ? `<div class="assistant-packages"><h4>Combinações recomendadas</h4><p class="small muted">Sugestões prontas para agilizar a locação e reunir os equipamentos mais usados nesse serviço.</p>${service.packages.map(pack => `
      <article class="assistant-package-card"><div class="package-discount">-${pack.discountPercent}%</div><div><strong>${escapeHtml(pack.name)}</strong><p>${escapeHtml(pack.description)}</p><ul>${pack.items.map(item => `<li>${item.quantity}x ${escapeHtml(item.name)}</li>`).join('')}</ul></div><button type="button" class="btn btn-primary btn-sm" data-select-package="${escapeHtml(pack.id)}">Selecionar pacote</button></article>`).join('')}</div>` : '';
    const recommendations = service.recommendations.map(item => `
      <article class="assistant-equipment-card"><img src="${escapeHtml(safeImage(item.image))}" alt="${escapeHtml(item.name)}"><div><strong>${escapeHtml(item.name)}</strong><span>${formatMoney(item.daily)}/dia</span></div><button type="button" class="btn btn-outline btn-sm" data-assistant-add="${escapeHtml(item.id)}">Adicionar</button></article>`).join('');
    const result = document.getElementById('assistantResult');
    if (!result) return;
    result.innerHTML = `<div class="assistant-result-head"><div><span class="eyebrow">${escapeHtml(service.category)}</span><h3>${escapeHtml(service.name)}</h3><p>${escapeHtml(service.description)}</p></div><button type="button" class="btn btn-outline btn-sm" data-view-category="${workCategory({ category: service.category })}">Ver categoria</button></div><h4>Equipamentos recomendados</h4><div class="assistant-equipment-grid">${recommendations}</div>${packageHtml}`;
    result.querySelectorAll('[data-assistant-add]').forEach(button => button.addEventListener('click', () => addToCart(button.dataset.assistantAdd, 1, '')));
    result.querySelectorAll('[data-select-package]').forEach(button => button.addEventListener('click', () => {
      const pack = service.packages.find(item => item.id === button.dataset.selectPackage);
      if (pack) selectPackage(pack, service.id);
    }));
    result.querySelector('[data-view-category]')?.addEventListener('click', event => {
      setCatalogCategory(event.currentTarget.dataset.viewCategory);
      document.getElementById('catalogo').scrollIntoView({ behavior: 'smooth' });
    });
  }

  function updateEstimate() {
    const start = document.getElementById('startDate').value;
    const end = document.getElementById('endDate').value;
    const delivery = document.getElementById('delivery').value === 'delivery';
    const couponCode = couponInput.value.trim().toUpperCase();
    const activeCoupon = state.loyalty?.coupons?.find(coupon => coupon.code.toUpperCase() === couponCode);
    const couponPercent = activeCoupon ? Number(activeCoupon.discountPercent) : 0;
    const packagePercent = state.selectedPackage ? Number(state.selectedPackage.discountPercent) : 0;
    const businessPercent = state.currentClient?.clientType === 'PJ' ? 5 : 0;
    const items = state.cart.map(cartItem => ({ ...cartItem, equipment: equipmentById(cartItem.equipmentId) })).filter(item => item.equipment);

    if (!items.length || !start || !end || new Date(end) <= new Date(start)) {
      document.getElementById('dailyCountValue').textContent = '0';
      ['rentalValue','freightValue','depositValue','discountValue','packageDiscountValue','businessDiscountValue','totalValue','guaranteeTotalValue'].forEach(id => document.getElementById(id).textContent = formatMoney(0));
      document.getElementById('discountLine').classList.add('hidden');
      document.getElementById('packageDiscountLine').classList.add('hidden');
      document.getElementById('businessDiscountLine').classList.add('hidden');
      document.getElementById('couponStatus').textContent = couponCode ? 'Cupom será validado ao confirmar' : 'Nenhum cupom aplicado';
      return null;
    }

    const units = Math.max(1, Math.ceil((new Date(end) - new Date(start)) / 86400000));
    const rental = items.reduce((sum, item) => sum + units * Number(item.equipment.daily) * item.quantity, 0);
    const packageDiscount = Number((rental * packagePercent / 100).toFixed(2));
    const businessDiscount = Number(((rental - packageDiscount) * businessPercent / 100).toFixed(2));
    const loyaltyDiscount = Number(((rental - packageDiscount - businessDiscount) * couponPercent / 100).toFixed(2));
    const freight = delivery ? 85 : 0;
    const deposit = items.reduce((sum, item) => sum + Number(item.equipment.deposit) * item.quantity, 0);
    const total = rental - packageDiscount - businessDiscount - loyaltyDiscount + freight;
    const totalWithGuarantee = total + deposit;
    document.getElementById('dailyCountValue').textContent = `${units} ${units === 1 ? 'diária' : 'diárias'}`;
    document.getElementById('rentalValue').textContent = formatMoney(rental);
    document.getElementById('packageDiscountValue').textContent = `- ${formatMoney(packageDiscount)}`;
    document.getElementById('packageDiscountLine').classList.toggle('hidden', packageDiscount <= 0);
    document.getElementById('businessDiscountValue').textContent = `- ${formatMoney(businessDiscount)}`;
    document.getElementById('businessDiscountLine').classList.toggle('hidden', businessDiscount <= 0);
    document.getElementById('discountValue').textContent = `- ${formatMoney(loyaltyDiscount)}`;
    document.getElementById('discountLine').classList.toggle('hidden', loyaltyDiscount <= 0);
    document.getElementById('couponStatus').textContent = activeCoupon ? `${couponPercent}% de desconto ObraFácil` : couponCode ? 'Cupom será validado ao confirmar' : 'Nenhum cupom aplicado';
    document.getElementById('freightValue').textContent = formatMoney(freight);
    document.getElementById('depositValue').textContent = formatMoney(deposit);
    document.getElementById('guaranteeTotalValue').textContent = formatMoney(totalWithGuarantee);
    document.getElementById('totalValue').textContent = formatMoney(total);
    return { items, start, end, delivery, units, rental, packageDiscount, businessDiscount, loyaltyDiscount, freight, deposit, total, totalWithGuarantee, couponCode };
  }

  function showEquipmentDetails(equipmentId) {
    const item = state.equipment.find(equipment => equipment.id === equipmentId);
    if (!item) return;
    document.getElementById('contractContent').innerHTML = `
      <div style="display:grid;grid-template-columns:180px 1fr;gap:20px;align-items:start">
        <img src="${escapeHtml(safeImage(item.image))}" alt="${escapeHtml(item.name)}" onerror="this.onerror=null;this.src='assets/photos/ferramentas.jpg'" style="width:100%;height:180px;object-fit:cover;border-radius:12px;background:#eef4f1">
        <div><h2 style="text-align:left;margin-top:0">${escapeHtml(item.name)}</h2><p>${escapeHtml(item.description)}</p>
        <p><strong>Categoria:</strong> ${escapeHtml(item.category)}<br><strong>Potência/material:</strong> ${escapeHtml(item.power)}<br><strong>Peso:</strong> ${escapeHtml(item.weight)}<br><strong>Patrimônio:</strong> ${escapeHtml(item.serial)}</p>
        <p><strong>Acessórios:</strong> ${escapeHtml(item.accessories.join(', ') || 'Não informado')}</p></div>
      </div>`;
    contractModal.classList.remove('hidden');
    document.getElementById('finishContract').classList.add('hidden');
    document.getElementById('invoiceButton')?.classList.add('hidden');
  }

  function buildFullAddress() {
    return [
      `${addressInput.value.trim()}, ${numberInput.value.trim()}`,
      complementInput.value.trim(),
      neighborhoodInput.value.trim(),
      `${cityInput.value.trim()} - ${stateInput.value.trim().toUpperCase()}`
    ].filter(Boolean).join(', ');
  }

  bookingForm.addEventListener('submit', async event => {
    event.preventDefault();
    const client = state.currentClient || window.CasaClienteAuth?.getCurrent();
    if (!client) { await window.CasaClienteAuth?.requireLogin(); return; }
    const estimate = updateEstimate();
    if (!state.cart.length) return showToast('Adicione pelo menos um equipamento ou selecione um pacote.', 'error');
    if (!estimate) return showToast('Preencha um período válido.', 'error');

    const signature = document.getElementById('signatureName').value.trim();
    const clientName = client.name;
    if (signature.toLocaleLowerCase('pt-BR') !== clientName.toLocaleLowerCase('pt-BR')) return showToast('A assinatura eletrônica deve corresponder ao nome do cliente.', 'error');

    const submitButton = bookingForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Verificando estoque e salvando...';
    try {
      const reservation = await api('/api/reservations', {
        method: 'POST',
        body: JSON.stringify({
          items: state.cart,
          packageId: state.selectedPackage?.id || '',
          serviceId: state.selectedServiceId || '',
          start: estimate.start, end: estimate.end, notes: document.getElementById('notes').value.trim(),
          delivery: estimate.delivery, paymentMethod: document.getElementById('paymentMethod').value,
          couponCode: couponInput.value.trim(), signature
        })
      });
      state.lastReservation = reservation;
      showContract(reservation);
    } catch (error) { showToast(error.message, 'error'); }
    finally { submitButton.disabled = false; submitButton.textContent = 'Confirmar solicitação e gerar contrato'; }
  });

  function showContract(reservation) {
    const itemList = (reservation.items || []).map(item => `<li>${item.quantity}x <strong>${escapeHtml(item.name)}</strong>${item.accessory ? ` — ${escapeHtml(item.accessory)}` : ''}</li>`).join('');
    const packageText = reservation.packageName ? `<p><strong>PACOTE:</strong> ${escapeHtml(reservation.packageName)}, com desconto de ${formatMoney(reservation.packageDiscount)}.</p>` : '';
    const businessText = reservation.businessDiscount > 0 ? `, benefício CNPJ de ${formatMoney(reservation.businessDiscount)}` : '';
    const loyaltyText = reservation.couponCode ? `, benefício ObraFácil aplicado (${escapeHtml(reservation.couponCode)})` : '';
    document.getElementById('contractContent').innerHTML = `
      <h2>CONTRATO DIGITAL DE LOCAÇÃO</h2><p style="text-align:center"><strong>${escapeHtml(reservation.contract)}</strong></p>
      <p><strong>LOCATÁRIO:</strong> ${escapeHtml(reservation.clientName)}, ${reservation.clientType === 'PJ' ? 'CNPJ' : 'CPF'} ${escapeHtml(reservation.document || reservation.cpf)}, telefone ${escapeHtml(reservation.phone)}, e-mail ${escapeHtml(reservation.email)}, residente em ${escapeHtml(reservation.address)}, CEP ${escapeHtml(reservation.cep)}.</p>
      <p><strong>EQUIPAMENTOS:</strong></p><ul>${itemList}</ul>${packageText}
      <p><strong>PERÍODO:</strong> retirada em ${new Date(reservation.start).toLocaleString('pt-BR')} e devolução prevista em ${new Date(reservation.end).toLocaleString('pt-BR')}, totalizando <strong>${reservation.dailyCount} diária(s)</strong>.</p>
      <p><strong>VALORES:</strong> locação ${formatMoney(reservation.rental)}, desconto total ${formatMoney(reservation.discount)}${businessText}${loyaltyText}, frete ${formatMoney(reservation.freight)}, garantia/caução vinculada ${formatMoney(reservation.deposit)} e total a pagar agora de <strong>${formatMoney(reservation.payNow || reservation.total)}</strong>. A garantia só será cobrada ou retida em caso de dano, perda, atraso ou devolução inadequada. Forma de pagamento: ${escapeHtml(reservation.paymentMethod)}.</p>
      <p><strong>RESPONSABILIDADES:</strong> o locatário compromete-se a usar os equipamentos conforme as orientações de segurança, devolvê-los no prazo e nas condições registradas no checklist.</p>
      <div class="contract-signature"><div class="signature-line">${escapeHtml(reservation.signature)}<br><span class="small muted">Locatário — assinado em ${new Date(reservation.signedAt).toLocaleString('pt-BR')}</span></div><div class="signature-line">Casa dos materiais<br><span class="small muted">Locadora</span></div></div>`;
    document.getElementById('finishContract').classList.remove('hidden');
    const invoiceButton = document.getElementById('invoiceButton');
    if (invoiceButton) { invoiceButton.href = `nota-fiscal.html?id=${encodeURIComponent(reservation.id)}`; invoiceButton.classList.remove('hidden'); }
    contractModal.classList.remove('hidden');
  }

  document.getElementById('simulateWhatsApp')?.addEventListener('click', () => {
    const reservation = state.lastReservation;
    if (!reservation) return showToast('Gere uma reserva antes de preparar a mensagem.', 'error');
    const items = (reservation.items || []).map(item => `${item.quantity}x ${item.name}`).join(', ');
    const message = `Olá, ${reservation.clientName}! Sua solicitação ${reservation.contract} foi registrada. Equipamentos: ${items}. Retirada: ${new Date(reservation.start).toLocaleString('pt-BR')}. Devolução: ${new Date(reservation.end).toLocaleString('pt-BR')}. Total a pagar agora: ${formatMoney(reservation.payNow || reservation.total)}. Garantia vinculada: ${formatMoney(reservation.deposit)}. Mensagem preparada pela Casa dos materiais para confirmar sua locação.`;
    const encoded = encodeURIComponent(message);
    const phone = onlyDigits(reservation.phone || '');
    const preview = document.createElement('div');
    preview.className = 'whatsapp-simulation';
    preview.setAttribute('role', 'dialog');
    preview.setAttribute('aria-modal', 'true');
    preview.setAttribute('aria-label', 'Prévia da confirmação por WhatsApp');
    preview.innerHTML = `<div class="whatsapp-card"><div class="whatsapp-head"><strong>📱 Confirmação por WhatsApp</strong><button type="button" aria-label="Fechar prévia">✕</button></div><p>${escapeHtml(message)}</p><div class="whatsapp-actions"><button class="btn btn-outline" type="button" data-copy>Copiar mensagem</button><a class="btn btn-primary" target="_blank" rel="noopener" href="https://wa.me/55${phone}?text=${encoded}">Abrir WhatsApp</a></div><small>O sistema prepara a mensagem com os dados da locação para envio no WhatsApp.</small></div>`;
    document.body.appendChild(preview);
    const trigger = document.getElementById('simulateWhatsApp');
    const close = () => { preview.remove(); trigger?.focus(); };
    preview.querySelector('.whatsapp-head button').addEventListener('click', close);
    preview.addEventListener('click', event => { if (event.target === preview) close(); });
    preview.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    preview.querySelector('[data-copy]').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(message);
        showToast('Mensagem copiada.');
      } catch {
        showToast('Não foi possível copiar automaticamente. Selecione a mensagem manualmente.', 'error');
      }
    });
    preview.querySelector('.whatsapp-head button').focus();
  });

  document.getElementById('closeContract').addEventListener('click', () => contractModal.classList.add('hidden'));
  document.getElementById('finishContract').addEventListener('click', () => {
    contractModal.classList.add('hidden');
    if (state.lastReservation) {
      showToast(`Solicitação ${state.lastReservation.contract} registrada com sucesso.`);
      bookingForm.reset();
      state.cart = [];
      state.selectedPackage = null;
      state.selectedServiceId = '';
      renderCart(); populateEquipment(); updateAccessories(); updateEstimate();
      state.lastReservation = null;
      window.CasaClienteAuth?.fillBooking(state.currentClient);
      loadLoyalty();
    }
  });

  equipmentSelect.addEventListener('change', updateAccessories);
  addEquipmentButton.addEventListener('click', () => {
    if (!equipmentSelect.value) return showToast('Selecione um equipamento.', 'error');
    addToCart(equipmentSelect.value, Math.max(1, Number(document.getElementById('quantity').value || 1)), accessorySelect.value);
    equipmentSelect.value = '';
    document.getElementById('quantity').value = 1;
    updateAccessories();
  });
  [document.getElementById('startDate'), document.getElementById('endDate'), document.getElementById('delivery')]
    .forEach(element => element.addEventListener('change', updateEstimate));


  document.addEventListener('client-auth-changed', event => {
    state.currentClient = event.detail || null;
    if (state.currentClient) {
      loadLoyalty();
    } else {
      state.loyalty = null;
      renderLoyaltyCard();
    }
    updateEstimate();
  });

  async function init() {
    const minStart = new Date();
    minStart.setMinutes(minStart.getMinutes() - minStart.getTimezoneOffset());
    document.getElementById('startDate').min = minStart.toISOString().slice(0, 16);
    document.getElementById('endDate').min = minStart.toISOString().slice(0, 16);
    try {
      const equipment = await api('/api/equipment');
      state.equipment = equipment;
      state.assistantServices = [];
      state.currentClient = window.CasaClienteAuth?.getCurrent() || null;
      renderCatalog(); populateEquipment(); renderCart(); renderAssistantServices();
      if (state.currentClient) loadLoyalty();
    } catch (error) {
      document.getElementById('catalogGrid').innerHTML = '<div class="empty-state"><strong>Não foi possível carregar o catálogo.</strong><br>Confirme se o servidor Node.js está em execução.</div>';
      showToast(error.message, 'error');
    }
  }

  init();
})();
