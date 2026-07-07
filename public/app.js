(() => {
  'use strict';

  function formatMoney(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
  }

  function formatDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('pt-BR');
  }

  function onlyDigits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function maskCPF(value) {
    return onlyDigits(value).slice(0, 11)
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }

  function maskPhone(value) {
    const digits = onlyDigits(value).slice(0, 11);
    if (digits.length <= 10) return digits.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
    return digits.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
  }

  function maskCEP(value) {
    return onlyDigits(value).slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2');
  }

  function maskInteger(value, maxLength = 8) {
    return onlyDigits(value).slice(0, maxLength);
  }

  const maskFunctions = { cpf: maskCPF, phone: maskPhone, cep: maskCEP, integer: maskInteger };

  function applyMasks(root = document) {
    root.querySelectorAll('[data-mask]').forEach(input => {
      const formatter = maskFunctions[input.dataset.mask];
      if (!formatter) return;
      input.value = formatter(input.value);
      if (input.dataset.maskBound === 'true') return;
      input.addEventListener('input', event => {
        event.target.value = formatter(event.target.value);
      });
      input.dataset.maskBound = 'true';
    });
  }

  function showToast(message, type = 'success') {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4300);
  }

  async function api(url, options = {}) {
    const config = {
      credentials: 'same-origin',
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    };
    const response = await fetch(url, config);
    const isJson = response.headers.get('content-type')?.includes('application/json');
    const data = isJson ? await response.json() : null;
    if (!response.ok) {
      const error = new Error(data?.error || `Erro HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function offsetDate(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  }

  window.CasaMateriais = Object.freeze({
    api,
    formatMoney,
    formatDateTime,
    onlyDigits,
    applyMasks,
    showToast,
    escapeHtml,
    offsetDate
  });
})();
