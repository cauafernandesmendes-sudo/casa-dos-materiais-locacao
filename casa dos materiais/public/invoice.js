(() => {
  'use strict';
  const { api, formatMoney, formatDateTime, escapeHtml } = window.CasaMateriais;
  const target = document.getElementById('printInvoice');
  const reservationId = new URLSearchParams(location.search).get('id');

  function render(invoice) {
    const r = invoice.reservation;
    const itemRows = (invoice.items || []).map(item => `
      <tr>
        <td>${escapeHtml(item.name)}</td>
        <td>${item.quantity}</td>
        <td>${formatMoney(item.dailyRate)}</td>
        <td>${r.dailyCount}</td>
        <td>${formatMoney(Number(item.dailyRate) * Number(item.quantity) * Number(r.dailyCount))}</td>
      </tr>`).join('');

    target.innerHTML = `
      <header class="print-contract-head invoice-head">
        <img src="assets/logo-casa-dos-materiais.png" alt="Casa dos materiais">
        <div>
          <h1>Recibo de locação</h1>
          <p><strong>${escapeHtml(invoice.invoiceNumber)}</strong> · ${escapeHtml(invoice.fiscalStatus)}</p>
        </div>
      </header>

      <div class="invoice-alert">
        <strong>Informação:</strong> ${escapeHtml(invoice.note)}
      </div>

      <section>
        <h3>Emitente</h3>
        <div class="contract-data-grid">
          <div><span>Empresa</span><strong>${escapeHtml(invoice.company.name)}</strong></div>
          <div><span>Documento</span><strong>${escapeHtml(invoice.company.document)}</strong></div>
          <div><span>Emissão</span><strong>${formatDateTime(invoice.issuedAt)}</strong></div>
          <div><span>Contrato vinculado</span><strong>${escapeHtml(r.contract)}</strong></div>
        </div>
      </section>

      <section>
        <h3>Cliente / tomador</h3>
        <div class="contract-data-grid">
          <div><span>Nome / empresa</span><strong>${escapeHtml(invoice.customer.name)}</strong></div>
          <div><span>${invoice.customer.type === 'PJ' ? 'CNPJ' : 'CPF'}</span><strong>${escapeHtml(invoice.customer.document)}</strong></div>
          <div><span>Contato</span><strong>${escapeHtml(invoice.customer.phone)} · ${escapeHtml(invoice.customer.email)}</strong></div>
          <div class="wide"><span>Endereço</span><strong>${escapeHtml(invoice.customer.address)}</strong></div>
        </div>
      </section>

      <section>
        <h3>Serviços e equipamentos locados</h3>
        <table class="contract-table">
          <thead><tr><th>Descrição</th><th>Qtd.</th><th>Diária</th><th>Diárias</th><th>Subtotal</th></tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
        <p><strong>Retirada:</strong> ${formatDateTime(r.start)} &nbsp; <strong>Devolução prevista:</strong> ${formatDateTime(r.end)}</p>
      </section>

      <section class="invoice-totals">
        <h3>Resumo financeiro</h3>
        <div class="contract-values">
          <div><span>Locação bruta</span><strong>${formatMoney(invoice.amounts.rental)}</strong></div>
          <div><span>Descontos</span><strong>- ${formatMoney(invoice.amounts.discount)}</strong></div>
          <div><span>Frete / entrega</span><strong>${formatMoney(invoice.amounts.freight)}</strong></div>
          <div><span>Total do recibo</span><strong>${formatMoney(invoice.amounts.liquid)}</strong></div>
          <div><span>Garantia vinculada</span><strong>${formatMoney(invoice.amounts.guarantee)}</strong></div>
          <div><span>Total com garantia</span><strong>${formatMoney(invoice.amounts.totalWithGuarantee)}</strong></div>
        </div>
        <p class="small muted">A garantia/caução não representa receita da locadora. Ela fica vinculada ao contrato e só pode ser cobrada ou retida em caso de dano, perda, atraso ou devolução inadequada.</p>
      </section>
    `;
  }

  async function init() {
    if (!reservationId) {
      target.innerHTML = '<div class="empty-state">Nota/recibo não encontrado.</div>';
      return;
    }
    try {
      render(await api(`/api/invoices/${encodeURIComponent(reservationId)}`));
    } catch (error) {
      target.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
  }

  init();
})();
