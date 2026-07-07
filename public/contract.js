(() => {
  'use strict';
  const { api, formatMoney, formatDateTime, escapeHtml } = window.CasaMateriais;
  const target = document.getElementById('printContract');
  const reservationId = new URLSearchParams(location.search).get('id');

  function documentLabel(item) {
    return item.clientType === 'PJ' ? 'CNPJ' : 'CPF';
  }

  function render(item) {
    const items = (item.items || []).map(row => `
      <tr><td>${row.quantity}</td><td>${escapeHtml(row.name)}</td><td>${formatMoney(row.dailyRate)}</td><td>${formatMoney(row.dailyRate * row.quantity * item.dailyCount)}</td></tr>`).join('');
    const assets = (item.assignedUnits || []).length
      ? `<section><h3>Unidades patrimoniais vinculadas</h3><ul>${item.assignedUnits.map(unit => `<li>${escapeHtml(unit.equipmentName)} — patrimônio <strong>${escapeHtml(unit.assetCode)}</strong></li>`).join('')}</ul></section>`
      : '';
    const discounts = [
      item.packageDiscount > 0 ? `<div><span>Desconto do pacote</span><strong>- ${formatMoney(item.packageDiscount)}</strong></div>` : '',
      item.businessDiscount > 0 ? `<div><span>Benefício empresarial</span><strong>- ${formatMoney(item.businessDiscount)}</strong></div>` : '',
      item.discount - item.packageDiscount - item.businessDiscount > 0 ? `<div><span>Desconto ObraFácil</span><strong>- ${formatMoney(item.discount - item.packageDiscount - item.businessDiscount)}</strong></div>` : ''
    ].join('');
    target.innerHTML = `
      <header class="print-contract-head">
        <img src="assets/logo-casa-dos-materiais.png" alt="Casa dos materiais">
        <div><h1>Contrato de locação de equipamentos</h1><p>${escapeHtml(item.contract)}</p></div>
      </header>
      <div class="contract-meta"><span>Emitido em ${new Date().toLocaleString('pt-BR')}</span><span>Assinado em ${formatDateTime(item.signedAt)}</span></div>
      <section><h3>Locatário</h3><div class="contract-data-grid">
        <div><span>Nome / responsável</span><strong>${escapeHtml(item.clientName)}</strong></div>
        ${item.clientType === 'PJ' ? `<div><span>Empresa</span><strong>${escapeHtml(item.tradeName || item.companyName)}</strong></div>` : ''}
        <div><span>${documentLabel(item)}</span><strong>${escapeHtml(item.document)}</strong></div>
        <div><span>Contato</span><strong>${escapeHtml(item.phone)} · ${escapeHtml(item.email)}</strong></div>
        <div class="wide"><span>Endereço</span><strong>${escapeHtml(item.address)}, ${escapeHtml(item.city)} - ${escapeHtml(item.state)}, CEP ${escapeHtml(item.cep)}</strong></div>
      </div></section>
      <section><h3>Equipamentos e período</h3><table class="contract-table"><thead><tr><th>Qtd.</th><th>Equipamento</th><th>Diária</th><th>Subtotal</th></tr></thead><tbody>${items}</tbody></table>
        <p><strong>Retirada:</strong> ${formatDateTime(item.start)} &nbsp; <strong>Devolução prevista:</strong> ${formatDateTime(item.end)} &nbsp; <strong>Diárias:</strong> ${item.dailyCount}</p>
      </section>
      ${assets}
      <section><h3>Valores</h3><div class="contract-values">
        <div><span>Locação</span><strong>${formatMoney(item.rental)}</strong></div>${discounts}
        <div><span>Frete</span><strong>${formatMoney(item.freight)}</strong></div>
        <div><span>Caução / garantia vinculada</span><strong>${formatMoney(item.deposit)}</strong></div>
        <div><span>Total com garantia</span><strong>${formatMoney(item.totalWithGuarantee || ((item.payNow || item.total) + item.deposit))}</strong></div>
        <div class="total"><span>Total a pagar agora</span><strong>${formatMoney(item.payNow || item.total)}</strong></div>
      </div></section>
      <section><h3>Condições gerais</h3><ol class="contract-clauses">
        <li>O locatário declara ter recebido ou receberá os equipamentos em condições adequadas de uso.</li>
        <li>A devolução após o prazo poderá gerar cobrança adicional proporcional às diárias e multa prevista pela locadora.</li>
        <li>A caução é uma garantia vinculada ao contrato e só será cobrada ou retida em caso de danos, perdas, peças faltantes, atraso ou uso indevido, mediante checklist de devolução.</li>
        <li>Os equipamentos devem ser utilizados conforme orientações de segurança e finalidade recomendada.</li>
        <li>O contrato digital e os registros de inspeção integram o histórico da reserva.</li>
      </ol></section>
      <section class="contract-signatures"><div><span>${escapeHtml(item.signature)}</span><small>Locatário — assinatura eletrônica</small></div><div><span>Casa dos materiais</span><small>Locadora</small></div></section>
      <footer class="contract-footer">Casa dos materiais · Locação de equipamentos · Documento gerado pelo sistema</footer>`;
  }

  document.getElementById('printContractButton').addEventListener('click', () => window.print());
  (async () => {
    if (!reservationId) { target.innerHTML = '<div class="empty-state">Contrato não informado.</div>'; return; }
    try { render(await api(`/api/contracts/${encodeURIComponent(reservationId)}`)); }
    catch (error) { target.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; }
  })();
})();
