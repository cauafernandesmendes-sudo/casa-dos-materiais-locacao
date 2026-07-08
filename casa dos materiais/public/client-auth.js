(() => {
  'use strict';

  const { api, applyMasks, onlyDigits, showToast } = window.CasaMateriais;
  const modal = document.getElementById('clientAuthModal');
  if (!modal) return;

  let currentClient = null;
  const loginButton = document.getElementById('clientLoginButton');
  const accountButton = document.getElementById('clientAccountButton');
  const logoutButton = document.getElementById('clientLogoutButton');
  const bookingLoginButton = document.getElementById('bookingLoginButton');
  const accountBanner = document.getElementById('accountRequiredBanner');

  function maskCPF(value) {
    return onlyDigits(value).slice(0, 11)
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }

  function maskCNPJ(value) {
    return onlyDigits(value).slice(0, 14)
      .replace(/(\d{2})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1/$2')
      .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
  }

  function formatDocument(value, type) {
    return type === 'PJ' ? maskCNPJ(value) : maskCPF(value);
  }

  function setReadonly(id, readonly = true) {
    const input = document.getElementById(id);
    if (!input) return;
    input.readOnly = readonly;
    input.classList.toggle('account-filled', readonly);
  }

  function fillBooking(client) {
    const values = {
      clientName: client?.name || '',
      clientCpf: client ? formatDocument(client.document, client.clientType) : '',
      clientPhone: client?.phone || '',
      clientEmail: client?.email || '',
      clientCep: client?.cep || '',
      clientAddress: client?.address || '',
      clientNumber: client?.addressNumber || '',
      clientNeighborhood: client?.neighborhood || '',
      clientCity: client?.city || '',
      clientState: client?.state || '',
      clientComplement: client?.complement || '',
      signatureName: client?.name || ''
    };
    Object.entries(values).forEach(([id, value]) => {
      const input = document.getElementById(id);
      if (input) input.value = value;
    });
    ['clientName','clientCpf','clientPhone','clientEmail','clientCep','clientAddress','clientNumber','clientNeighborhood','clientCity','clientState','clientComplement']
      .forEach(id => setReadonly(id, Boolean(client)));
    const label = document.getElementById('clientDocumentLabel');
    if (label) label.textContent = client?.clientType === 'PJ' ? 'CNPJ' : 'CPF';
    const signature = document.getElementById('signatureName');
    if (signature) signature.readOnly = Boolean(client);
  }

  function updateUi() {
    const logged = Boolean(currentClient);
    loginButton?.classList.toggle('hidden', logged);
    accountButton?.classList.toggle('hidden', !logged);
    logoutButton?.classList.toggle('hidden', !logged);
    accountBanner?.classList.toggle('logged', logged);
    if (accountBanner) {
      accountBanner.innerHTML = logged
        ? `<div><strong>Conta conectada</strong><p>${currentClient.clientType === 'PJ' ? `${currentClient.tradeName || currentClient.companyName} · benefício empresarial de 5%` : `${currentClient.name} · reservas vinculadas à sua conta`}</p></div><a class="btn btn-secondary btn-sm" href="minha-conta.html">Abrir minha conta</a>`
        : '<div><strong>Entre na sua conta para reservar</strong><p>Seus dados serão preenchidos automaticamente e suas reservas ficarão disponíveis em “Minha conta”.</p></div><button class="btn btn-primary btn-sm" id="bookingLoginButtonDynamic" type="button">Entrar ou criar conta</button>';
      document.getElementById('bookingLoginButtonDynamic')?.addEventListener('click', () => openModal('login'));
    }
    fillBooking(currentClient);
    document.dispatchEvent(new CustomEvent('client-auth-changed', { detail: currentClient }));
  }

  function switchTab(tab) {
    document.querySelectorAll('[data-auth-tab]').forEach(button => button.classList.toggle('active', button.dataset.authTab === tab));
    document.getElementById('clientLoginForm').classList.toggle('active', tab === 'login');
    document.getElementById('clientRegisterForm').classList.toggle('active', tab === 'register');
  }

  function openModal(tab = 'login') {
    switchTab(tab);
    modal.classList.remove('hidden');
    setTimeout(() => document.querySelector(tab === 'login' ? '#loginClientEmail' : '#registerName')?.focus(), 50);
  }

  function closeModal() {
    modal.classList.add('hidden');
  }

  async function loadSession() {
    try {
      currentClient = await api('/api/client/me');
    } catch {
      currentClient = null;
    }
    updateUi();
    return currentClient;
  }

  async function requireLogin() {
    if (currentClient) return currentClient;
    openModal('login');
    showToast('Entre ou crie uma conta para concluir a reserva.', 'info');
    return null;
  }

  document.querySelectorAll('[data-auth-tab]').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.authTab)));
  loginButton?.addEventListener('click', () => openModal('login'));
  bookingLoginButton?.addEventListener('click', () => openModal('login'));
  document.getElementById('closeClientAuth')?.addEventListener('click', closeModal);
  modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });

  document.getElementById('clientLoginForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Entrando...';
    try {
      currentClient = await api('/api/client/login', {
        method: 'POST',
        body: JSON.stringify({
          email: document.getElementById('loginClientEmail').value.trim(),
          password: document.getElementById('loginClientPassword').value
        })
      });
      closeModal();
      updateUi();
      showToast(`Bem-vindo, ${currentClient.name}.`);
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Entrar';
    }
  });

  const typeSelect = document.getElementById('registerClientType');
  const documentInput = document.getElementById('registerDocument');
  function updateRegisterType() {
    const pj = typeSelect.value === 'PJ';
    document.querySelectorAll('.company-field').forEach(element => element.classList.toggle('hidden', !pj));
    document.getElementById('registerNameLabel').textContent = pj ? 'Responsável pela empresa' : 'Nome completo';
    document.getElementById('registerDocumentLabel').textContent = pj ? 'CNPJ' : 'CPF';
    documentInput.placeholder = pj ? '00.000.000/0000-00' : '000.000.000-00';
    documentInput.value = formatDocument(documentInput.value, pj ? 'PJ' : 'PF');
  }
  typeSelect.addEventListener('change', updateRegisterType);
  documentInput.addEventListener('input', () => { documentInput.value = formatDocument(documentInput.value, typeSelect.value); });
  updateRegisterType();

  const registerCep = document.getElementById('registerCep');
  async function lookupRegisterCep() {
    const cep = onlyDigits(registerCep.value);
    if (cep.length !== 8) return;
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await response.json();
      if (data.erro) return showToast('CEP não encontrado.', 'error');
      document.getElementById('registerAddress').value = data.logradouro || '';
      document.getElementById('registerNeighborhood').value = data.bairro || '';
      document.getElementById('registerCity').value = data.localidade || '';
      document.getElementById('registerState').value = data.uf || '';
      document.getElementById('registerAddressNumber').focus();
    } catch {
      showToast('Não foi possível consultar o CEP. Preencha o endereço manualmente.', 'error');
    }
  }
  registerCep.addEventListener('blur', lookupRegisterCep);
  registerCep.addEventListener('input', () => { if (onlyDigits(registerCep.value).length === 8) lookupRegisterCep(); });

  document.getElementById('clientRegisterForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Criando conta...';
    try {
      currentClient = await api('/api/client/register', {
        method: 'POST',
        body: JSON.stringify({
          clientType: typeSelect.value,
          companyName: document.getElementById('registerCompanyName').value.trim(),
          tradeName: document.getElementById('registerTradeName').value.trim(),
          name: document.getElementById('registerName').value.trim(),
          document: documentInput.value,
          phone: document.getElementById('registerPhone').value,
          email: document.getElementById('registerEmail').value.trim(),
          password: document.getElementById('registerPassword').value,
          cep: registerCep.value,
          address: document.getElementById('registerAddress').value.trim(),
          addressNumber: document.getElementById('registerAddressNumber').value.trim(),
          complement: document.getElementById('registerComplement').value.trim(),
          neighborhood: document.getElementById('registerNeighborhood').value.trim(),
          city: document.getElementById('registerCity').value.trim(),
          state: document.getElementById('registerState').value.trim().toUpperCase()
        })
      });
      closeModal();
      updateUi();
      showToast('Conta criada com sucesso. Você já pode reservar.');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Criar conta e entrar';
    }
  });

  logoutButton?.addEventListener('click', async () => {
    try { await api('/api/client/logout', { method: 'POST' }); } catch {}
    currentClient = null;
    updateUi();
    showToast('Você saiu da conta.', 'info');
  });

  applyMasks(modal);
  window.CasaClienteAuth = Object.freeze({ loadSession, getCurrent: () => currentClient, requireLogin, openModal, fillBooking });
  loadSession();
})();
