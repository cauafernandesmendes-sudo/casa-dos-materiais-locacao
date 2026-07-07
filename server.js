'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const { db, parseEquipment, hashPassword, verifyPassword } = require('./database');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');

app.disable('x-powered-by');
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  name: 'casa.sid',
  secret: process.env.SESSION_SECRET || 'casa-dos-materiais-tcc-altere-em-producao',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 8 * 60 * 60 * 1000
  }
}));

function id(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function cleanText(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function onlyDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function parseNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isValidDate(value) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

function toIsoInput(value) {
  const date = new Date(value);
  return date.toISOString();
}

function dailyCount(start, end) {
  return Math.max(1, Math.ceil((new Date(end) - new Date(start)) / 86400000));
}

function makeContractNumber() {
  const suffix = String(Date.now()).slice(-6);
  return `CT-${new Date().getFullYear()}-${suffix}`;
}

function availableQuantity(equipmentId, start, end, ignoredReservationId = null) {
  const equipment = db.prepare('SELECT total, status FROM equipment WHERE id = ?').get(equipmentId);
  if (!equipment || equipment.status !== 'disponivel') return 0;

  const row = db.prepare(`
    SELECT COALESCE(SUM(ri.quantity), 0) AS reserved
    FROM reservation_items ri
    INNER JOIN reservations r ON r.id = ri.reservation_id
    WHERE ri.equipment_id = ?
      AND r.status NOT IN ('cancelada', 'concluida')
      AND datetime(r.start_at) < datetime(?)
      AND datetime(r.end_at) > datetime(?)
      AND (? IS NULL OR r.id <> ?)
  `).get(equipmentId, end, start, ignoredReservationId, ignoredReservationId);

  const unitCount = db.prepare(`SELECT COUNT(*) AS total FROM equipment_units
    WHERE equipment_id=? AND status NOT IN ('manutencao','indisponivel')`).get(equipmentId);
  const operationalTotal = Number(unitCount.total) || Number(equipment.total);
  return Math.max(0, operationalTotal - Number(row.reserved || 0));
}


function safeJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function syncEquipmentUnits(equipmentId, desiredTotal) {
  const equipment = db.prepare('SELECT id, serial, status, next_review FROM equipment WHERE id = ?').get(equipmentId);
  if (!equipment) return;
  const units = db.prepare('SELECT * FROM equipment_units WHERE equipment_id = ? ORDER BY asset_code').all(equipmentId);
  const target = Math.max(0, Number(desiredTotal) || 0);
  if (units.length < target) {
    const insert = db.prepare(`INSERT INTO equipment_units
      (id, equipment_id, asset_code, serial_number, status, next_review, notes)
      VALUES (?, ?, ?, ?, ?, ?, '')`);
    for (let index = units.length + 1; index <= target; index += 1) {
      const suffix = String(index).padStart(3, '0');
      const assetCode = `${equipment.serial}-${suffix}`;
      insert.run(id('unit'), equipmentId, assetCode, assetCode, equipment.status === 'disponivel' ? 'disponivel' : equipment.status, equipment.next_review);
    }
  } else if (units.length > target) {
    const excess = units.slice(target).filter(unit => !['em_uso','reservado'].includes(unit.status));
    const update = db.prepare("UPDATE equipment_units SET status='indisponivel', updated_at=CURRENT_TIMESTAMP WHERE id=?");
    excess.forEach(unit => update.run(unit.id));
  }
}

function assignedUnitsForReservation(reservationId) {
  return db.prepare(`
    SELECT eu.id, eu.asset_code AS assetCode, eu.serial_number AS serialNumber,
      eu.status, eu.next_review AS nextReview, e.id AS equipmentId, e.name AS equipmentName,
      rua.assigned_at AS assignedAt, rua.released_at AS releasedAt
    FROM reservation_unit_assignments rua
    INNER JOIN equipment_units eu ON eu.id = rua.equipment_unit_id
    INNER JOIN equipment e ON e.id = eu.equipment_id
    WHERE rua.reservation_id = ? ORDER BY e.name, eu.asset_code
  `).all(reservationId);
}

function assignUnitsForReservation(reservationId) {
  const existing = db.prepare('SELECT COUNT(*) AS total FROM reservation_unit_assignments WHERE reservation_id=? AND released_at IS NULL').get(reservationId);
  if (Number(existing.total) > 0) return assignedUnitsForReservation(reservationId);
  const items = db.prepare('SELECT equipment_id AS equipmentId, quantity FROM reservation_items WHERE reservation_id=?').all(reservationId);
  const insert = db.prepare('INSERT INTO reservation_unit_assignments (id, reservation_id, equipment_unit_id) VALUES (?, ?, ?)');
  const update = db.prepare("UPDATE equipment_units SET status='em_uso', updated_at=CURRENT_TIMESTAMP WHERE id=?");
  for (const item of items) {
    const units = db.prepare(`SELECT id FROM equipment_units WHERE equipment_id=? AND status='disponivel' ORDER BY asset_code LIMIT ?`).all(item.equipmentId, Number(item.quantity));
    if (units.length < Number(item.quantity)) throw publicError(`Não há unidades patrimoniais suficientes para ${item.equipmentId}.`);
    for (const unit of units) { insert.run(id('asg'), reservationId, unit.id); update.run(unit.id); }
  }
  return assignedUnitsForReservation(reservationId);
}

function releaseUnitsForReservation(reservationId) {
  const rows = db.prepare('SELECT equipment_unit_id AS unitId FROM reservation_unit_assignments WHERE reservation_id=? AND released_at IS NULL').all(reservationId);
  const release = db.prepare('UPDATE reservation_unit_assignments SET released_at=CURRENT_TIMESTAMP WHERE reservation_id=? AND equipment_unit_id=? AND released_at IS NULL');
  const update = db.prepare("UPDATE equipment_units SET status='disponivel', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='em_uso'");
  for (const row of rows) { release.run(reservationId, row.unitId); update.run(row.unitId); }
}

function quoteFor(equipment, start, end, quantity, delivery, discountPercent = 0) {
  return quoteForItems([{ equipment, quantity }], start, end, delivery, 0, discountPercent);
}

function quoteForItems(items, start, end, delivery, packageDiscountPercent = 0, couponDiscountPercent = 0, businessDiscountPercent = 0) {
  const units = dailyCount(start, end);
  const rental = items.reduce((sum, item) => sum + units * Number(item.equipment.daily) * Number(item.quantity), 0);
  const deposit = items.reduce((sum, item) => sum + Number(item.equipment.deposit) * Number(item.quantity), 0);
  const freight = delivery ? 85 : 0;
  const safePackagePercent = Math.max(0, Math.min(100, Number(packageDiscountPercent) || 0));
  const safeCouponPercent = Math.max(0, Math.min(100, Number(couponDiscountPercent) || 0));
  const safeBusinessPercent = Math.max(0, Math.min(100, Number(businessDiscountPercent) || 0));
  const packageDiscount = Number((rental * safePackagePercent / 100).toFixed(2));
  const afterPackage = rental - packageDiscount;
  const businessDiscount = Number((afterPackage * safeBusinessPercent / 100).toFixed(2));
  const afterBusiness = afterPackage - businessDiscount;
  const loyaltyDiscount = Number((afterBusiness * safeCouponPercent / 100).toFixed(2));
  const discount = Number((packageDiscount + businessDiscount + loyaltyDiscount).toFixed(2));
  return {
    units,
    rental,
    packageDiscountPercent: safePackagePercent,
    packageDiscount,
    couponDiscountPercent: safeCouponPercent,
    businessDiscountPercent: safeBusinessPercent,
    businessDiscount,
    loyaltyDiscount,
    discount,
    freight,
    deposit,
    payNow: Number((rental - discount + freight).toFixed(2)),
    totalWithGuarantee: Number((rental - discount + freight + deposit).toFixed(2)),
    total: Number((rental - discount + freight).toFixed(2))
  };
}

function loyaltyLevel(points) {
  if (points >= 500) return 'Obra Premium';
  if (points >= 250) return 'Ouro';
  if (points >= 100) return 'Prata';
  return 'Bronze';
}

function nextLoyaltyTarget(points) {
  if (points < 100) return 100;
  if (points < 250) return 250;
  if (points < 500) return 500;
  return null;
}

function ensureLoyaltyAccount(clientId) {
  db.prepare(`
    INSERT OR IGNORE INTO loyalty_accounts (client_id, points, level, completed_rentals)
    VALUES (?, 0, 'Bronze', 0)
  `).run(clientId);
  return db.prepare('SELECT * FROM loyalty_accounts WHERE client_id = ?').get(clientId);
}

function expireLoyaltyCoupons(clientId = null) {
  const condition = clientId ? ' AND client_id = ?' : '';
  const statement = db.prepare(`
    UPDATE loyalty_coupons
    SET status = 'expirado'
    WHERE status = 'ativo' AND datetime(expires_at) < datetime('now')${condition}
  `);
  if (clientId) statement.run(clientId); else statement.run();
}

function loyaltySummaryByClient(client) {
  if (!client) return null;
  expireLoyaltyCoupons(client.id);
  const account = ensureLoyaltyAccount(client.id);
  const coupons = db.prepare(`
    SELECT code, discount_percent AS discountPercent, status, expires_at AS expiresAt
    FROM loyalty_coupons
    WHERE client_id = ? AND status = 'ativo'
    ORDER BY datetime(expires_at) ASC
  `).all(client.id);
  const history = db.prepare(`
    SELECT points, description, created_at AS createdAt
    FROM loyalty_transactions
    WHERE client_id = ? ORDER BY datetime(created_at) DESC LIMIT 8
  `).all(client.id);
  const target = nextLoyaltyTarget(Number(account.points));
  return {
    registered: true,
    clientId: client.id,
    clientName: client.name,
    points: Number(account.points),
    level: account.level,
    completedRentals: Number(account.completed_rentals),
    nextLevelPoints: target,
    pointsToNextLevel: target ? Math.max(0, target - Number(account.points)) : 0,
    coupons,
    history
  };
}

function validateCoupon(cpf, couponCode) {
  const code = cleanText(couponCode, 60).toUpperCase();
  if (!code) return null;
  const client = db.prepare('SELECT id FROM clients WHERE cpf = ?').get(onlyDigits(cpf));
  if (!client) throw publicError('Cupom não encontrado para este CPF.');
  expireLoyaltyCoupons(client.id);
  const coupon = db.prepare(`
    SELECT * FROM loyalty_coupons
    WHERE client_id = ? AND code = ? COLLATE NOCASE AND status = 'ativo'
  `).get(client.id, code);
  if (!coupon) throw publicError('Cupom inválido, utilizado ou expirado.');
  return coupon;
}

function generateLoyaltyCoupon(clientId, completedRentals) {
  const existing = db.prepare(`
    SELECT id FROM loyalty_coupons
    WHERE client_id = ? AND code LIKE ?
  `).get(clientId, `OBRA10-${completedRentals}-%`);
  if (existing) return null;
  const code = `OBRA10-${completedRentals}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const expiresAt = new Date(Date.now() + 90 * 86400000).toISOString();
  db.prepare(`
    INSERT INTO loyalty_coupons (id, client_id, code, discount_percent, status, expires_at)
    VALUES (?, ?, ?, 10, 'ativo', ?)
  `).run(id('cup'), clientId, code, expiresAt);
  return { code, discountPercent: 10, expiresAt };
}

function awardLoyaltyForReservation(reservationId) {
  const alreadyAwarded = db.prepare('SELECT id FROM loyalty_transactions WHERE reservation_id = ?').get(reservationId);
  if (alreadyAwarded) return null;

  const reservation = db.prepare(`
    SELECT r.id, r.contract, r.client_id, r.daily_count, r.quantity, r.end_at,
      c.name AS client_name
    FROM reservations r INNER JOIN clients c ON c.id = r.client_id
    WHERE r.id = ?
  `).get(reservationId);
  if (!reservation) throw publicError('Reserva não encontrada.', 404);

  const returnInspection = db.prepare(`
    SELECT condition_status FROM inspections
    WHERE reservation_id = ? AND inspection_type = 'devolucao'
    ORDER BY datetime(inspected_at) DESC LIMIT 1
  `).get(reservationId);

  const basePoints = Number(reservation.daily_count) * Number(reservation.quantity) * 10;
  const onTimeBonus = new Date() <= new Date(reservation.end_at) ? 20 : 0;
  const careBonus = returnInspection?.condition_status === 'bom' ? 10 : 0;
  const points = basePoints + onTimeBonus + careBonus;
  const parts = [`${basePoints} ponto(s) pelas diárias`];
  if (onTimeBonus) parts.push('20 por devolução no prazo');
  if (careBonus) parts.push('10 por devolução sem avarias');

  const account = ensureLoyaltyAccount(reservation.client_id);
  const completedRentals = Number(account.completed_rentals) + 1;
  const newPoints = Number(account.points) + points;
  const level = loyaltyLevel(newPoints);

  db.prepare(`
    INSERT INTO loyalty_transactions (id, client_id, reservation_id, points, description)
    VALUES (?, ?, ?, ?, ?)
  `).run(id('pts'), reservation.client_id, reservationId, points, `Contrato ${reservation.contract}: ${parts.join(', ')}`);

  db.prepare(`
    UPDATE loyalty_accounts
    SET points = ?, level = ?, completed_rentals = ?, updated_at = CURRENT_TIMESTAMP
    WHERE client_id = ?
  `).run(newPoints, level, completedRentals, reservation.client_id);

  const coupon = completedRentals % 5 === 0
    ? generateLoyaltyCoupon(reservation.client_id, completedRentals)
    : null;

  return { points, totalPoints: newPoints, level, completedRentals, coupon };
}

function equipmentRows(where = '') {
  return db.prepare(`SELECT * FROM equipment ${where} ORDER BY category, name`).all().map(parseEquipment);
}

function assistantData(includeInactive = false) {
  const activeWhere = includeInactive ? '' : 'WHERE s.active = 1';
  const packageActive = includeInactive ? '' : 'AND p.active = 1';
  const services = db.prepare(`
    SELECT s.id, s.name, s.description, s.category, s.icon, s.active, s.sort_order AS sortOrder
    FROM assistant_services s ${activeWhere}
    ORDER BY s.sort_order, s.name
  `).all().map(service => {
    const recommendations = db.prepare(`
      SELECT e.*
      FROM assistant_recommendations ar
      INNER JOIN equipment e ON e.id = ar.equipment_id
      WHERE ar.service_id = ? ${includeInactive ? '' : "AND e.status = 'disponivel'"}
      ORDER BY ar.priority, e.name
    `).all(service.id).map(parseEquipment);
    const packages = db.prepare(`
      SELECT p.id, p.name, p.description, p.discount_percent AS discountPercent, p.active
      FROM rental_packages p
      WHERE p.service_id = ? ${packageActive}
      ORDER BY p.name
    `).all(service.id).map(pack => ({
      ...pack,
      active: Boolean(pack.active),
      items: db.prepare(`
        SELECT e.*, rpi.quantity
        FROM rental_package_items rpi
        INNER JOIN equipment e ON e.id = rpi.equipment_id
        WHERE rpi.package_id = ?
        ORDER BY e.category, e.name
      `).all(pack.id).map(row => ({ ...parseEquipment(row), quantity: Number(row.quantity) }))
    }));
    return { ...service, active: Boolean(service.active), recommendations, packages };
  });
  return services;
}

function packageById(packageId, requireActive = true) {
  if (!packageId) return null;
  const pack = db.prepare(`
    SELECT p.id, p.service_id AS serviceId, p.name, p.description,
      p.discount_percent AS discountPercent, p.active
    FROM rental_packages p WHERE p.id = ?
  `).get(packageId);
  if (!pack || (requireActive && !pack.active)) return null;
  pack.items = db.prepare(`
    SELECT e.*, rpi.quantity
    FROM rental_package_items rpi
    INNER JOIN equipment e ON e.id = rpi.equipment_id
    WHERE rpi.package_id = ?
    ORDER BY e.name
  `).all(packageId).map(row => ({ equipment: parseEquipment(row), quantity: Number(row.quantity), accessory: '' }));
  return pack;
}

function normalizedRequestedItems(body) {
  const raw = Array.isArray(body.items) && body.items.length
    ? body.items
    : [{ equipmentId: body.equipmentId, quantity: body.quantity, accessory: body.accessory }];
  const merged = new Map();
  for (const value of raw.slice(0, 20)) {
    const equipmentId = cleanText(value?.equipmentId, 100);
    if (!equipmentId) continue;
    const quantity = Math.max(1, Math.min(99, Math.floor(parseNumber(value?.quantity, 1))));
    const accessory = cleanText(value?.accessory, 200);
    const current = merged.get(equipmentId);
    if (current) current.quantity += quantity;
    else merged.set(equipmentId, { equipmentId, quantity, accessory });
  }
  return [...merged.values()];
}

function resolveRequestSelection(body) {
  const packageId = cleanText(body.packageId, 100);
  const pack = packageById(packageId, true);
  if (packageId && !pack) throw publicError('Pacote indisponível ou desativado.');
  const requestItems = pack
    ? pack.items.map(item => ({ equipmentId: item.equipment.id, quantity: item.quantity, accessory: '' }))
    : normalizedRequestedItems(body);
  if (!requestItems.length) throw publicError('Selecione pelo menos um equipamento.');
  const items = requestItems.map(item => {
    const row = db.prepare('SELECT * FROM equipment WHERE id = ?').get(item.equipmentId);
    if (!row || row.status !== 'disponivel') throw publicError('Um dos equipamentos selecionados está indisponível.');
    return { ...item, equipment: parseEquipment(row) };
  });
  return {
    items,
    package: pack,
    serviceId: cleanText(body.serviceId, 100) || pack?.serviceId || ''
  };
}

function reservationRows(where = '', params = []) {
  const rows = db.prepare(`
    SELECT r.*, c.name AS client_name, c.cpf, c.phone, c.email, c.cep, c.address,
      c.address_number, c.complement, c.neighborhood, c.city, c.state, c.client_type, c.company_name, c.trade_name, p.method AS payment_method_db,
      p.status AS payment_status_db, p.paid_at
    FROM reservations r
    INNER JOIN clients c ON c.id = r.client_id
    LEFT JOIN payments p ON p.reservation_id = r.id
    ${where}
    ORDER BY datetime(r.created_at) DESC
  `).all(...params);
  const itemStatement = db.prepare(`
    SELECT ri.equipment_id AS equipmentId, ri.quantity, ri.daily_rate AS dailyRate,
      ri.accessory, e.name, e.category, e.serial, e.image
    FROM reservation_items ri INNER JOIN equipment e ON e.id = ri.equipment_id
    WHERE ri.reservation_id = ? ORDER BY e.name
  `);
  return rows.map(row => {
    const items = itemStatement.all(row.id).map(item => ({
      ...item,
      quantity: Number(item.quantity),
      dailyRate: Number(item.dailyRate),
      accessory: item.accessory || ''
    }));
    const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
    const assignedUnits = assignedUnitsForReservation(row.id);
    return {
      id: row.id,
      contract: row.contract,
      createdAt: row.created_at,
      status: row.status,
      paymentStatus: row.payment_status_db || row.payment_status,
      clientName: row.client_name,
      cpf: row.cpf,
      document: row.cpf,
      clientType: row.client_type || 'PF',
      companyName: row.company_name || '',
      tradeName: row.trade_name || '',
      phone: row.phone,
      email: row.email,
      cep: row.cep,
      address: row.address,
      addressNumber: row.address_number || '',
      complement: row.complement || '',
      neighborhood: row.neighborhood,
      city: row.city,
      state: row.state,
      items,
      assignedUnits,
      equipmentId: items[0]?.equipmentId || '',
      equipmentName: items.map(item => item.name).join(', '),
      equipmentCategory: [...new Set(items.map(item => item.category))].join(', '),
      equipmentSerial: items.map(item => item.serial).join(', '),
      quantity,
      dailyRate: Number(row.daily_count) ? Number(row.rental) / Number(row.daily_count) : 0,
      dailyCount: row.daily_count,
      start: row.start_at,
      end: row.end_at,
      accessory: row.accessory || '',
      notes: row.notes || '',
      delivery: Boolean(row.delivery),
      paymentMethod: row.payment_method_db || row.payment_method,
      rental: Number(row.rental),
      discount: Number(row.discount || 0),
      couponCode: row.coupon_code || '',
      packageId: row.package_id || '',
      packageName: row.package_name || '',
      packageDiscount: Number(row.package_discount || 0),
      businessDiscount: Number(row.business_discount || 0),
      serviceId: row.service_id || '',
      freight: Number(row.freight),
      deposit: Number(row.deposit),
      payNow: Number((Number(row.rental) - Number(row.discount || 0) + Number(row.freight)).toFixed(2)),
      totalWithGuarantee: Number((Number(row.rental) - Number(row.discount || 0) + Number(row.freight) + Number(row.deposit)).toFixed(2)),
      total: Number((Number(row.rental) - Number(row.discount || 0) + Number(row.freight)).toFixed(2)),
      signature: row.signature,
      signedAt: row.signed_at,
      paidAt: row.paid_at
    };
  });
}

function calculateLateFee(reservation) {
  if (reservation.status !== 'em_uso' || new Date() <= new Date(reservation.end)) return 0;
  const overdueDays = Math.max(1, Math.ceil((Date.now() - new Date(reservation.end).getTime()) / 86400000));
  const dailyRental = Number(reservation.dailyCount) ? Number(reservation.rental) / Number(reservation.dailyCount) : 0;
  return overdueDays * dailyRental * 1.2;
}


function fullReservationAddress(reservation) {
  return [
    [reservation.address, reservation.addressNumber].filter(Boolean).join(', '),
    reservation.complement,
    reservation.neighborhood,
    `${reservation.city || ''} - ${reservation.state || ''}`,
    reservation.cep ? `CEP ${reservation.cep}` : ''
  ].filter(Boolean).join(', ');
}

function mapUrlForReservation(reservation, mode = 'search') {
  const query = encodeURIComponent(fullReservationAddress(reservation));
  if (mode === 'route') return `https://www.google.com/maps/dir/?api=1&destination=${query}`;
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

function ensureDeliveryControl(reservationId) {
  const reservation = db.prepare('SELECT id, delivery FROM reservations WHERE id=?').get(reservationId);
  if (!reservation || !Number(reservation.delivery)) return null;
  const existing = db.prepare('SELECT * FROM delivery_controls WHERE reservation_id=?').get(reservationId);
  if (existing) return existing;
  const deliveryId = id('del');
  db.prepare(`
    INSERT INTO delivery_controls (id, reservation_id, delivery_status, pickup_status)
    VALUES (?, ?, 'aguardando', 'pendente')
  `).run(deliveryId, reservationId);
  return db.prepare('SELECT * FROM delivery_controls WHERE reservation_id=?').get(reservationId);
}

function deliveryStatusLabel(status) {
  return {
    aguardando: 'Aguardando entrega',
    em_rota: 'Em rota de entrega',
    entregue: 'Entregue ao cliente',
    cancelado: 'Cancelado'
  }[status] || status;
}

function pickupStatusLabel(status) {
  return {
    pendente: 'Recolhimento pendente',
    agendado: 'Recolhimento agendado',
    em_rota: 'Em rota de recolhimento',
    recolhido: 'Equipamento recolhido',
    cancelado: 'Cancelado'
  }[status] || status;
}

function deliveryRows() {
  const reservations = reservationRows().filter(item => item.delivery && item.status !== 'cancelada');
  return reservations.map(reservation => {
    const control = ensureDeliveryControl(reservation.id) || {};
    return {
      ...reservation,
      deliveryStatus: control.delivery_status || 'aguardando',
      deliveryStatusLabel: deliveryStatusLabel(control.delivery_status || 'aguardando'),
      pickupStatus: control.pickup_status || 'pendente',
      pickupStatusLabel: pickupStatusLabel(control.pickup_status || 'pendente'),
      scheduledAt: control.scheduled_at || '',
      deliveredAt: control.delivered_at || '',
      pickupScheduledAt: control.pickup_scheduled_at || '',
      pickedUpAt: control.picked_up_at || '',
      responsibleName: control.responsible_name || '',
      vehiclePlate: control.vehicle_plate || '',
      trackingNotes: control.tracking_notes || '',
      fullAddress: fullReservationAddress(reservation),
      mapUrl: mapUrlForReservation(reservation),
      routeUrl: mapUrlForReservation(reservation, 'route'),
      embedMapUrl: `https://maps.google.com/maps?q=${encodeURIComponent(fullReservationAddress(reservation))}&output=embed`
    };
  });
}

function invoiceForReservation(reservation) {
  const liquid = Number(reservation.payNow || reservation.total || 0);
  const guarantee = Number(reservation.deposit || 0);
  const invoiceNumber = `NF-${String(reservation.contract || '').replace(/^CT-?/i, '')}`;
  return {
    invoiceNumber,
    issuedAt: new Date().toISOString(),
    documentType: 'Recibo de locação',
    fiscalStatus: 'Documento gerado pelo sistema',
    company: {
      name: 'Casa dos materiais',
      document: '00.000.000/0001-00',
      city: 'Operação local'
    },
    customer: {
      name: reservation.clientType === 'PJ' ? (reservation.tradeName || reservation.companyName || reservation.clientName) : reservation.clientName,
      responsible: reservation.clientName,
      document: reservation.document,
      type: reservation.clientType,
      email: reservation.email,
      phone: reservation.phone,
      address: fullReservationAddress(reservation)
    },
    reservation,
    items: reservation.items || [],
    amounts: {
      rental: reservation.rental,
      discount: reservation.discount,
      freight: reservation.freight,
      liquid,
      guarantee,
      totalWithGuarantee: reservation.totalWithGuarantee || (liquid + guarantee)
    },
    note: 'Documento gerado automaticamente pelo sistema para conferência da locação e apoio operacional.'
  };
}



function clientPublicRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    clientType: row.client_type || 'PF',
    document: row.cpf,
    companyName: row.company_name || '',
    tradeName: row.trade_name || '',
    phone: row.phone,
    email: row.email,
    cep: row.cep,
    address: row.address,
    addressNumber: row.address_number || '',
    complement: row.complement || '',
    neighborhood: row.neighborhood,
    city: row.city,
    state: row.state
  };
}

function currentClient(req) {
  if (!req.session.clientId) return null;
  return db.prepare('SELECT * FROM clients WHERE id = ?').get(req.session.clientId) || null;
}

function requireClient(req, res, next) {
  const client = currentClient(req);
  if (!client) return res.status(401).json({ error: 'Entre na sua conta para continuar.' });
  req.client = client;
  next();
}

function validateClientDocument(type, value) {
  const document = onlyDigits(value);
  if (type === 'PJ' && document.length !== 14) throw publicError('CNPJ inválido. Digite 14 números.');
  if (type === 'PF' && document.length !== 11) throw publicError('CPF inválido. Digite 11 números.');
  return document;
}

function requireAdmin(req, res, next) {
  if (!req.session.adminId) return res.status(401).json({ error: 'Sessão administrativa expirada.' });
  next();
}

function handleError(res, error, fallback = 'Não foi possível concluir a operação.') {
  console.error(error);
  const message = error && error.publicMessage ? error.publicMessage : fallback;
  res.status(error.statusCode || 500).json({ error: message });
}

function publicError(message, statusCode = 400) {
  const error = new Error(message);
  error.publicMessage = message;
  error.statusCode = statusCode;
  return error;
}

app.get('/api/health', (req, res) => {
  const result = db.prepare('SELECT 1 AS ok').get();
  res.json({ ok: result.ok === 1, database: 'SQLite', timestamp: new Date().toISOString() });
});

app.get('/api/equipment', (req, res) => {
  res.json(equipmentRows("WHERE status = 'disponivel'"));
});

app.get('/api/loyalty/:cpf', (req, res) => {
  try {
    const cpf = onlyDigits(req.params.cpf);
    if (cpf.length !== 11) throw publicError('CPF inválido.');
    const client = db.prepare('SELECT id, name FROM clients WHERE cpf = ?').get(cpf);
    if (!client) {
      return res.json({ registered: false, points: 0, level: 'Bronze', completedRentals: 0, coupons: [], history: [] });
    }
    res.json(loyaltySummaryByClient(client));
  } catch (error) {
    handleError(res, error, 'Não foi possível consultar o programa de fidelidade.');
  }
});

app.get('/api/assistant', (req, res) => {
  try {
    res.json({ services: assistantData(false) });
  } catch (error) {
    handleError(res, error, 'Não foi possível carregar o assistente de locação.');
  }
});

app.post('/api/quote', (req, res) => {
  try {
    const start = cleanText(req.body.start, 50);
    const end = cleanText(req.body.end, 50);
    const delivery = Boolean(req.body.delivery);
    const coupon = validateCoupon(req.body.cpf, req.body.couponCode);
    if (!isValidDate(start) || !isValidDate(end) || new Date(end) <= new Date(start)) {
      throw publicError('Informe um período válido.');
    }
    const selection = resolveRequestSelection(req.body);
    const availability = selection.items.map(item => ({
      equipmentId: item.equipment.id,
      name: item.equipment.name,
      requested: item.quantity,
      available: availableQuantity(item.equipment.id, start, end)
    }));
    const unavailable = availability.find(item => item.available < item.requested);
    if (unavailable) throw publicError(`${unavailable.name}: somente ${unavailable.available} unidade(s) disponível(is) no período.`, 409);
    const sessionClient = currentClient(req);
    const businessDiscountPercent = sessionClient?.client_type === 'PJ' ? 5 : 0;
    const quote = quoteForItems(
      selection.items,
      start,
      end,
      delivery,
      selection.package?.discountPercent || 0,
      coupon?.discount_percent || 0,
      businessDiscountPercent
    );
    res.json({
      ...quote,
      availability,
      packageId: selection.package?.id || '',
      packageName: selection.package?.name || '',
      couponCode: coupon?.code || '',
      items: selection.items.map(item => ({
        equipmentId: item.equipment.id,
        name: item.equipment.name,
        quantity: item.quantity,
        daily: Number(item.equipment.daily),
        deposit: Number(item.equipment.deposit)
      }))
    });
  } catch (error) {
    handleError(res, error);
  }
});

function createReservation(payload) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const selection = resolveRequestSelection(payload);
    for (const item of selection.items) {
      const available = availableQuantity(item.equipment.id, payload.start, payload.end);
      if (available < item.quantity) {
        throw publicError(`${item.equipment.name}: quantidade indisponível no período escolhido.`, 409);
      }
    }

    const coupon = validateCoupon(payload.client.cpf, payload.couponCode);
    const businessDiscountPercent = payload.client.clientType === 'PJ' ? 5 : 0;
    const quote = quoteForItems(
      selection.items,
      payload.start,
      payload.end,
      payload.delivery,
      selection.package?.discountPercent || 0,
      coupon?.discount_percent || 0,
      businessDiscountPercent
    );

    const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(payload.clientId);
    if (!client) throw publicError('Conta do cliente não encontrada. Entre novamente.', 401);
    const reservationId = id('res');
    const contract = makeContractNumber();
    const signedAt = new Date().toISOString();
    const totalQuantity = selection.items.reduce((sum, item) => sum + item.quantity, 0);

    db.prepare(`
      INSERT INTO reservations (
        id, contract, client_id, status, payment_status, start_at, end_at, quantity,
        accessory, notes, delivery, payment_method, daily_count, rental, discount,
        coupon_code, package_id, package_name, package_discount, business_discount, service_id, freight,
        deposit, total, signature, signed_at
      ) VALUES (?, ?, ?, 'pendente', 'pendente', ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      reservationId, contract, client.id, payload.start, payload.end, totalQuantity,
      payload.notes, payload.delivery ? 1 : 0, payload.paymentMethod, quote.units,
      quote.rental, quote.discount, coupon?.code || null, selection.package?.id || null,
      selection.package?.name || null, quote.packageDiscount, quote.businessDiscount, selection.serviceId || null,
      quote.freight, quote.deposit, quote.total, payload.signature, signedAt
    );

    const insertItem = db.prepare(`
      INSERT INTO reservation_items (reservation_id, equipment_id, quantity, daily_rate, accessory)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const item of selection.items) {
      insertItem.run(reservationId, item.equipment.id, item.quantity, item.equipment.daily, item.accessory || '');
    }

    db.prepare(`INSERT INTO payments (id, reservation_id, method, amount, status) VALUES (?, ?, ?, ?, 'pendente')`)
      .run(id('pay'), reservationId, payload.paymentMethod, quote.payNow);

    if (payload.delivery) ensureDeliveryControl(reservationId);

    if (coupon) {
      db.prepare(`UPDATE loyalty_coupons SET status='utilizado', used_reservation_id=? WHERE id=? AND status='ativo'`)
        .run(reservationId, coupon.id);
    }

    const objectLines = selection.items.map(item => `${item.quantity}x ${item.equipment.name}`).join('; ');
    const contractContent = [
      'CONTRATO DIGITAL DE LOCAÇÃO', contract,
      `Locatário: ${payload.client.clientType === 'PJ' ? `${payload.client.companyName} (responsável: ${payload.client.name})` : payload.client.name}, ${payload.client.clientType === 'PJ' ? 'CNPJ' : 'CPF'} ${payload.client.cpf}.`,
      `Objeto: ${objectLines}.`,
      selection.package ? `Pacote: ${selection.package.name} (${selection.package.discountPercent}% de desconto).` : '',
      `Período: ${payload.start} até ${payload.end}, ${quote.units} diária(s).`,
      `Locação: R$ ${quote.rental.toFixed(2)}; desconto empresarial: R$ ${quote.businessDiscount.toFixed(2)}; desconto total: R$ ${quote.discount.toFixed(2)}; frete: R$ ${quote.freight.toFixed(2)}; total a pagar agora: R$ ${quote.payNow.toFixed(2)}; garantia vinculada: R$ ${quote.deposit.toFixed(2)}.`,
      `Assinado eletronicamente por ${payload.signature} em ${signedAt}.`
    ].filter(Boolean).join('\n');

    db.prepare(`
      INSERT INTO contracts (id, reservation_id, contract_number, content, signed_name, signed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id('ctr'), reservationId, contract, contractContent, payload.signature, signedAt);

    db.exec('COMMIT');
    return reservationId;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

app.post('/api/reservations', requireClient, (req, res) => {
  try {
    const start = cleanText(req.body.start, 50);
    const end = cleanText(req.body.end, 50);
    const signature = cleanText(req.body.signature, 160);
    const client = req.client;

    if (!signature || signature.toLocaleLowerCase('pt-BR') !== client.name.toLocaleLowerCase('pt-BR')) {
      throw publicError('A assinatura eletrônica deve corresponder ao nome do responsável pela conta.');
    }
    if (!isValidDate(start) || !isValidDate(end) || new Date(end) <= new Date(start)) throw publicError('O período de locação é inválido.');
    if (new Date(start) < new Date(Date.now() - 5 * 60 * 1000)) throw publicError('A retirada não pode ser marcada no passado.');

    const payload = {
      clientId: client.id,
      items: normalizedRequestedItems(req.body),
      packageId: cleanText(req.body.packageId, 100),
      serviceId: cleanText(req.body.serviceId, 100),
      start: toIsoInput(start),
      end: toIsoInput(end),
      notes: cleanText(req.body.notes, 2000),
      delivery: Boolean(req.body.delivery),
      paymentMethod: cleanText(req.body.paymentMethod, 80),
      couponCode: cleanText(req.body.couponCode, 60).toUpperCase(),
      signature,
      client: {
        name: client.name,
        cpf: client.cpf,
        clientType: client.client_type || 'PF',
        companyName: client.company_name || '',
        tradeName: client.trade_name || '',
        phone: client.phone,
        email: client.email,
        cep: client.cep,
        address: [client.address, client.address_number, client.complement].filter(Boolean).join(', '),
        neighborhood: client.neighborhood,
        city: client.city,
        state: client.state
      }
    };
    if ((!payload.items.length && !payload.packageId) || !payload.paymentMethod) {
      throw publicError('Preencha todos os dados obrigatórios.');
    }
    const reservationId = createReservation(payload);
    res.status(201).json(reservationRows('WHERE r.id = ?', [reservationId])[0]);
  } catch (error) {
    handleError(res, error, 'Não foi possível registrar a reserva.');
  }
});

// Autenticação e área do cliente
app.post('/api/client/register', (req, res) => {
  try {
    const clientType = cleanText(req.body.clientType, 2).toUpperCase() === 'PJ' ? 'PJ' : 'PF';
    const document = validateClientDocument(clientType, req.body.document);
    const name = cleanText(req.body.name, 160);
    const companyName = cleanText(req.body.companyName, 200);
    const tradeName = cleanText(req.body.tradeName, 200);
    const email = cleanText(req.body.email, 200).toLowerCase();
    const password = String(req.body.password || '');
    const phone = cleanText(req.body.phone, 30);
    const cep = cleanText(req.body.cep, 15);
    const address = cleanText(req.body.address, 300);
    const addressNumber = cleanText(req.body.addressNumber, 30);
    const complement = cleanText(req.body.complement, 120);
    const neighborhood = cleanText(req.body.neighborhood, 120);
    const city = cleanText(req.body.city, 120);
    const state = cleanText(req.body.state, 2).toUpperCase();

    if (!name || !email || password.length < 6 || onlyDigits(phone).length < 10 || onlyDigits(cep).length !== 8 || !address || !addressNumber || !neighborhood || !city || state.length !== 2) {
      throw publicError('Preencha todos os campos obrigatórios. A senha deve ter pelo menos 6 caracteres.');
    }
    if (clientType === 'PJ' && !companyName) throw publicError('Informe a razão social.');
    const existingDocument = db.prepare('SELECT * FROM clients WHERE cpf = ?').get(document);
    const existingEmail = db.prepare('SELECT * FROM clients WHERE email = ? COLLATE NOCASE').get(email);
    let clientId;
    if (existingDocument && !existingDocument.password_hash && existingDocument.email.toLowerCase() === email) {
      db.prepare(`UPDATE clients SET name=?, phone=?, cep=?, address=?, address_number=?, complement=?, neighborhood=?, city=?, state=?, client_type=?, company_name=?, trade_name=?, password_hash=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(name, phone, cep, address, addressNumber, complement, neighborhood, city, state, clientType, companyName, tradeName, hashPassword(password), existingDocument.id);
      clientId = existingDocument.id;
    } else {
      if (existingDocument) throw publicError('CPF/CNPJ já cadastrado.', 409);
      if (existingEmail) throw publicError('E-mail já cadastrado.', 409);
      const result = db.prepare(`
        INSERT INTO clients (
          name, cpf, phone, email, cep, address, address_number, complement,
          neighborhood, city, state, client_type, company_name, trade_name, password_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(name, document, phone, email, cep, address, addressNumber, complement, neighborhood, city, state, clientType, companyName, tradeName, hashPassword(password));
      clientId = Number(result.lastInsertRowid);
    }
    ensureLoyaltyAccount(clientId);
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
    req.session.regenerate(error => {
      if (error) return handleError(res, error, 'Conta criada, mas não foi possível iniciar a sessão.');
      req.session.clientId = client.id;
      res.status(201).json(clientPublicRow(client));
    });
  } catch (error) {
    handleError(res, error, 'Não foi possível criar a conta.');
  }
});

app.post('/api/client/login', (req, res) => {
  const email = cleanText(req.body.email, 200).toLowerCase();
  const password = String(req.body.password || '');
  const client = db.prepare('SELECT * FROM clients WHERE email = ? COLLATE NOCASE').get(email);
  if (!client || !client.password_hash || !verifyPassword(password, client.password_hash)) {
    return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
  }
  req.session.regenerate(error => {
    if (error) return handleError(res, error, 'Não foi possível iniciar a sessão.');
    req.session.clientId = client.id;
    res.json(clientPublicRow(client));
  });
});

app.get('/api/client/me', requireClient, (req, res) => {
  res.json(clientPublicRow(req.client));
});

app.post('/api/client/logout', (req, res) => {
  delete req.session.clientId;
  req.session.save(() => res.status(204).end());
});

app.patch('/api/client/profile', requireClient, (req, res) => {
  try {
    const phone = cleanText(req.body.phone, 30);
    const cep = cleanText(req.body.cep, 15);
    const address = cleanText(req.body.address, 300);
    const addressNumber = cleanText(req.body.addressNumber, 30);
    const complement = cleanText(req.body.complement, 120);
    const neighborhood = cleanText(req.body.neighborhood, 120);
    const city = cleanText(req.body.city, 120);
    const state = cleanText(req.body.state, 2).toUpperCase();
    if (onlyDigits(phone).length < 10 || onlyDigits(cep).length !== 8 || !address || !addressNumber || !neighborhood || !city || state.length !== 2) {
      throw publicError('Preencha corretamente telefone e endereço.');
    }
    db.prepare(`UPDATE clients SET phone=?, cep=?, address=?, address_number=?, complement=?, neighborhood=?, city=?, state=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(phone, cep, address, addressNumber, complement, neighborhood, city, state, req.client.id);
    res.json(clientPublicRow(db.prepare('SELECT * FROM clients WHERE id=?').get(req.client.id)));
  } catch (error) {
    handleError(res, error, 'Não foi possível atualizar os dados.');
  }
});

app.get('/api/client/dashboard', requireClient, (req, res) => {
  try {
    const reservations = reservationRows('WHERE r.client_id = ?', [req.client.id]);
    const loyalty = req.client.client_type === 'PF'
      ? loyaltySummaryByClient(req.client)
      : { registered: true, points: 0, level: 'Empresa', completedRentals: reservations.filter(r => r.status === 'concluida').length, coupons: [], history: [], businessDiscountPercent: 5 };
    const summary = {
      totalReservations: reservations.length,
      activeReservations: reservations.filter(item => ['pendente','confirmada','em_uso'].includes(item.status)).length,
      pendingPayments: reservations.filter(item => item.paymentStatus === 'pendente' && item.status !== 'cancelada').reduce((sum, item) => sum + item.total, 0),
      totalSpent: reservations.filter(item => item.paymentStatus === 'pago').reduce((sum, item) => sum + item.total, 0)
    };
    const now = new Date();
    const notifications = [];
    reservations.filter(item => ['confirmada','em_uso'].includes(item.status)).forEach(item => {
      const startHours = (new Date(item.start) - now) / 3600000;
      const endHours = (new Date(item.end) - now) / 3600000;
      if (item.status === 'confirmada' && startHours >= 0 && startHours <= 48) notifications.push({ type: 'info', title: 'Retirada próxima', message: `${item.contract} começa em breve.`, reservationId: item.id });
      if (item.status === 'em_uso' && endHours < 0) notifications.push({ type: 'danger', title: 'Devolução atrasada', message: `${item.contract} está fora do prazo.`, reservationId: item.id });
      else if (item.status === 'em_uso' && endHours >= 0 && endHours <= 24) notifications.push({ type: 'warning', title: 'Devolução vence hoje', message: `${item.contract} deve ser devolvido em breve.`, reservationId: item.id });
      if (item.paymentStatus === 'pendente') notifications.push({ type: 'warning', title: 'Pagamento pendente', message: `${item.contract} possui valor pendente.`, reservationId: item.id });
    });
    if (loyalty.coupons?.length) notifications.push({ type: 'success', title: 'Cupom disponível', message: `Você possui ${loyalty.coupons.length} cupom(ns) ativo(s).` });
    res.json({ client: clientPublicRow(req.client), summary, loyalty, reservations, notifications: notifications.slice(0, 8) });
  } catch (error) {
    handleError(res, error, 'Não foi possível carregar sua conta.');
  }
});

app.get('/api/client/reservations/:id', requireClient, (req, res) => {
  try {
    const reservation = reservationRows('WHERE r.id = ? AND r.client_id = ?', [req.params.id, req.client.id])[0];
    if (!reservation) throw publicError('Reserva não encontrada.', 404);
    const contract = db.prepare('SELECT content, contract_number AS contractNumber, signed_name AS signedName, signed_at AS signedAt FROM contracts WHERE reservation_id = ?').get(reservation.id);
    res.json({ ...reservation, contractDocument: contract || null });
  } catch (error) {
    handleError(res, error, 'Não foi possível carregar a reserva.');
  }
});


app.get('/api/contracts/:reservationId', (req, res) => {
  try {
    const reservation = reservationRows('WHERE r.id = ?', [req.params.reservationId])[0];
    if (!reservation) throw publicError('Contrato não encontrado.', 404);
    const isAdmin = Boolean(req.session.adminId);
    const isOwner = Boolean(req.session.clientId) && Number(req.session.clientId) === Number(db.prepare('SELECT client_id FROM reservations WHERE id=?').get(req.params.reservationId)?.client_id);
    if (!isAdmin && !isOwner) throw publicError('Acesso não autorizado.', 401);
    const contractDocument = db.prepare('SELECT content, contract_number AS contractNumber, signed_name AS signedName, signed_at AS signedAt FROM contracts WHERE reservation_id=?').get(req.params.reservationId);
    const inspections = db.prepare(`SELECT inspection_type AS type, condition_status AS conditionStatus, notes, responsible_name AS responsibleName, inspected_at AS inspectedAt FROM inspections WHERE reservation_id=? ORDER BY datetime(inspected_at)`).all(req.params.reservationId);
    res.json({ ...reservation, contractDocument, inspections });
  } catch (error) { handleError(res, error, 'Não foi possível carregar o contrato.'); }
});


app.get('/api/invoices/:reservationId', (req, res) => {
  try {
    const reservation = reservationRows('WHERE r.id = ?', [req.params.reservationId])[0];
    if (!reservation) throw publicError('Nota/recibo não encontrado.', 404);
    const isAdmin = Boolean(req.session.adminId);
    const owner = db.prepare('SELECT client_id FROM reservations WHERE id=?').get(req.params.reservationId);
    const isOwner = Boolean(req.session.clientId) && Number(req.session.clientId) === Number(owner?.client_id);
    if (!isAdmin && !isOwner) throw publicError('Acesso não autorizado.', 401);
    res.json(invoiceForReservation(reservation));
  } catch (error) { handleError(res, error, 'Não foi possível carregar a nota/recibo.'); }
});


app.post('/api/auth/login', (req, res) => {
  const email = cleanText(req.body.email, 200).toLowerCase();
  const password = String(req.body.password || '');
  const admin = db.prepare('SELECT * FROM administrators WHERE email = ? COLLATE NOCASE').get(email);

  if (!admin || !verifyPassword(password, admin.password_hash)) {
    return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
  }

  req.session.regenerate(error => {
    if (error) return handleError(res, error, 'Não foi possível iniciar a sessão.');
    req.session.adminId = admin.id;
    req.session.adminName = admin.name;
    res.json({ id: admin.id, name: admin.name, email: admin.email });
  });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.adminId) return res.status(401).json({ error: 'Não autenticado.' });
  const admin = db.prepare('SELECT id, name, email FROM administrators WHERE id = ?').get(req.session.adminId);
  if (!admin) return res.status(401).json({ error: 'Sessão inválida.' });
  res.json(admin);
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('casa.sid');
    res.status(204).end();
  });
});

app.use('/api/admin', requireAdmin);

app.get('/api/admin/equipment', (req, res) => {
  res.json(equipmentRows());
});

app.post('/api/admin/equipment', (req, res) => {
  try {
    const item = normalizeEquipmentPayload(req.body, false);
    db.prepare(`
      INSERT INTO equipment (
        id, name, category, total, status, daily, deposit, power, weight, serial,
        next_review, accessories, image, description
      ) VALUES (
        @id, @name, @category, @total, @status, @daily, @deposit, @power, @weight, @serial,
        @nextReview, @accessoriesJson, @image, @description
      )
    `).run(item);
    syncEquipmentUnits(item.id, item.total);
    res.status(201).json(parseEquipment(db.prepare('SELECT * FROM equipment WHERE id = ?').get(item.id)));
  } catch (error) {
    if (String(error.message).includes('UNIQUE constraint failed')) error = publicError('Patrimônio/série já cadastrado.', 409);
    handleError(res, error, 'Não foi possível cadastrar o equipamento.');
  }
});

app.put('/api/admin/equipment/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM equipment WHERE id = ?').get(req.params.id);
    if (!existing) throw publicError('Equipamento não encontrado.', 404);
    const item = normalizeEquipmentPayload({ ...req.body, id: req.params.id }, true);
    db.prepare(`
      UPDATE equipment SET
        name=@name, category=@category, total=@total, status=@status, daily=@daily,
        deposit=@deposit, power=@power, weight=@weight, serial=@serial,
        next_review=@nextReview, accessories=@accessoriesJson, image=@image,
        description=@description, updated_at=CURRENT_TIMESTAMP
      WHERE id=@id
    `).run(item);
    syncEquipmentUnits(item.id, item.total);
    res.json(parseEquipment(db.prepare('SELECT * FROM equipment WHERE id = ?').get(item.id)));
  } catch (error) {
    if (String(error.message).includes('UNIQUE constraint failed')) error = publicError('Patrimônio/série já cadastrado.', 409);
    handleError(res, error, 'Não foi possível atualizar o equipamento.');
  }
});

function normalizeEquipmentPayload(body, isUpdate) {
  const statuses = new Set(['disponivel', 'manutencao', 'indisponivel']);
  const status = statuses.has(body.status) ? body.status : 'disponivel';
  const accessories = Array.isArray(body.accessories)
    ? body.accessories.map(value => cleanText(value, 120)).filter(Boolean)
    : cleanText(body.accessories, 1000).split(',').map(value => value.trim()).filter(Boolean);

  const item = {
    id: isUpdate ? cleanText(body.id, 100) : id('eq'),
    name: cleanText(body.name, 180),
    category: cleanText(body.category, 120),
    total: Math.max(0, Math.floor(parseNumber(body.total, 0))),
    status,
    daily: Math.max(0, parseNumber(body.daily, 0)),
    deposit: Math.max(0, parseNumber(body.deposit, 0)),
    power: cleanText(body.power, 120),
    weight: cleanText(body.weight, 120),
    serial: cleanText(body.serial, 120),
    nextReview: cleanText(body.nextReview, 20),
    accessoriesJson: JSON.stringify(accessories),
    image: cleanText(body.image, 500) || 'assets/photos/ferramentas.jpg',
    description: cleanText(body.description, 2000)
  };

  if (!item.name || !item.category || !item.serial || !/^\d{4}-\d{2}-\d{2}$/.test(item.nextReview)) {
    throw publicError('Preencha nome, categoria, patrimônio e próxima revisão.');
  }
  return item;
}


app.get('/api/admin/units', (req, res) => {
  const rows = db.prepare(`
    SELECT eu.id, eu.equipment_id AS equipmentId, e.name AS equipmentName, e.category,
      eu.asset_code AS assetCode, eu.serial_number AS serialNumber, eu.status,
      eu.last_review AS lastReview, eu.next_review AS nextReview, eu.notes,
      r.id AS reservationId, r.contract, c.name AS clientName
    FROM equipment_units eu
    INNER JOIN equipment e ON e.id = eu.equipment_id
    LEFT JOIN reservation_unit_assignments rua ON rua.equipment_unit_id = eu.id AND rua.released_at IS NULL
    LEFT JOIN reservations r ON r.id = rua.reservation_id
    LEFT JOIN clients c ON c.id = r.client_id
    ORDER BY e.category, e.name, eu.asset_code
  `).all();
  res.json(rows);
});

app.patch('/api/admin/units/:id', (req, res) => {
  try {
    const unit = db.prepare('SELECT * FROM equipment_units WHERE id=?').get(req.params.id);
    if (!unit) throw publicError('Unidade patrimonial não encontrada.', 404);
    const allowed = new Set(['disponivel','reservado','em_uso','manutencao','indisponivel']);
    const status = allowed.has(req.body.status) ? req.body.status : unit.status;
    const nextReview = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.nextReview || '')) ? req.body.nextReview : unit.next_review;
    const serialNumber = cleanText(req.body.serialNumber || unit.serial_number, 150);
    const notes = cleanText(req.body.notes, 2000);
    db.prepare(`UPDATE equipment_units SET status=?, next_review=?, serial_number=?, notes=?,
      last_review=CASE WHEN ?='disponivel' AND status='manutencao' THEN date('now') ELSE last_review END,
      updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(status, nextReview, serialNumber, notes, status, req.params.id);
    res.json(db.prepare(`SELECT id, equipment_id AS equipmentId, asset_code AS assetCode, serial_number AS serialNumber,
      status, last_review AS lastReview, next_review AS nextReview, notes FROM equipment_units WHERE id=?`).get(req.params.id));
  } catch (error) { handleError(res, error, 'Não foi possível atualizar a unidade patrimonial.'); }
});

app.get('/api/admin/reservations', (req, res) => {
  res.json(reservationRows());
});

app.get('/api/admin/reservations/:id', (req, res) => {
  const reservation = reservationRows('WHERE r.id = ?', [req.params.id])[0];
  if (!reservation) return res.status(404).json({ error: 'Reserva não encontrada.' });
  reservation.inspections = db.prepare(`
    SELECT id, inspection_type AS type, condition_status AS conditionStatus,
           notes, checklist_json AS checklistJson, photos_json AS photosJson,
           responsible_name AS responsibleName, inspected_at AS inspectedAt
    FROM inspections WHERE reservation_id = ? ORDER BY datetime(inspected_at) DESC
  `).all(req.params.id).map(item => ({
    ...item,
    checklist: safeJson(item.checklistJson, {}),
    photos: safeJson(item.photosJson, [])
  }));
  reservation.contractDocument = db.prepare('SELECT content, contract_number AS contractNumber, signed_name AS signedName, signed_at AS signedAt FROM contracts WHERE reservation_id = ?').get(reservation.id) || null;
  res.json(reservation);
});

function updateReservation(reservationId, status, paymentStatus) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
    if (!reservation) throw publicError('Reserva não encontrada.', 404);

    db.prepare(`UPDATE reservations SET status = ?, payment_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(status, paymentStatus, reservationId);

    db.prepare(`
      UPDATE payments SET status = ?, paid_at = CASE WHEN ? = 'pago' THEN COALESCE(paid_at, CURRENT_TIMESTAMP) ELSE paid_at END,
        updated_at = CURRENT_TIMESTAMP
      WHERE reservation_id = ?
    `).run(paymentStatus, paymentStatus, reservationId);

    if (status === 'em_uso' && reservation.status !== 'em_uso') assignUnitsForReservation(reservationId);
    if (['concluida','cancelada'].includes(status) && !['concluida','cancelada'].includes(reservation.status)) releaseUnitsForReservation(reservationId);

    const loyaltyAward = status === 'concluida' && reservation.status !== 'concluida'
      ? awardLoyaltyForReservation(reservationId)
      : null;
    db.exec('COMMIT');
    return loyaltyAward;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

app.patch('/api/admin/reservations/:id', (req, res) => {
  try {
    const allowedStatus = new Set(['pendente','confirmada','em_uso','concluida','cancelada']);
    const allowedPayment = new Set(['pendente','pago','estornado']);
    const current = db.prepare('SELECT status, payment_status FROM reservations WHERE id = ?').get(req.params.id);
    if (!current) throw publicError('Reserva não encontrada.', 404);

    const status = allowedStatus.has(req.body.status) ? req.body.status : current.status;
    let paymentStatus = allowedPayment.has(req.body.paymentStatus) ? req.body.paymentStatus : current.payment_status;
    if (status === 'confirmada' && paymentStatus === 'pendente') paymentStatus = 'pago';

    const loyaltyAward = updateReservation(req.params.id, status, paymentStatus);
    res.json({ ...reservationRows('WHERE r.id = ?', [req.params.id])[0], loyaltyAward });
  } catch (error) {
    handleError(res, error, 'Não foi possível atualizar a reserva.');
  }
});

app.post('/api/admin/reservations/:id/inspections', (req, res) => {
  try {
    const reservation = db.prepare('SELECT id FROM reservations WHERE id = ?').get(req.params.id);
    if (!reservation) throw publicError('Reserva não encontrada.', 404);
    const type = req.body.type;
    if (!['retirada','devolucao'].includes(type)) throw publicError('Tipo de checklist inválido.');
    const conditionStatus = ['bom','atencao','avariado'].includes(req.body.conditionStatus) ? req.body.conditionStatus : 'bom';
    const inspectedAt = new Date().toISOString();
    const inspectionId = id('insp');
    const checklist = req.body.checklist && typeof req.body.checklist === 'object' ? req.body.checklist : {};
    const photos = Array.isArray(req.body.photos) ? req.body.photos.filter(value => typeof value === 'string' && value.startsWith('data:image/')).slice(0, 4) : [];
    const responsibleName = cleanText(req.body.responsibleName, 180);
    db.prepare(`
      INSERT INTO inspections (id, reservation_id, inspection_type, condition_status, notes, checklist_json, photos_json, responsible_name, inspected_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(inspectionId, req.params.id, type, conditionStatus, cleanText(req.body.notes, 3000), JSON.stringify(checklist), JSON.stringify(photos), responsibleName, inspectedAt);
    res.status(201).json({ id: inspectionId, reservationId: req.params.id, type, conditionStatus, notes: cleanText(req.body.notes, 3000), checklist, photos, responsibleName, inspectedAt });
  } catch (error) {
    handleError(res, error, 'Não foi possível salvar o checklist.');
  }
});

app.get('/api/admin/maintenance', (req, res) => {
  const history = db.prepare(`
    SELECT m.id, m.equipment_id AS equipmentId, e.name AS equipmentName,
      m.service_date AS date, m.next_review AS nextReview, m.service, m.notes,
      m.status_after AS statusAfter, m.created_at AS createdAt
    FROM maintenance m
    INNER JOIN equipment e ON e.id = m.equipment_id
    ORDER BY date(m.service_date) DESC, datetime(m.created_at) DESC
  `).all();
  res.json(history);
});

function createMaintenance(payload) {
  db.exec('BEGIN IMMEDIATE');
  try {
  const equipment = db.prepare('SELECT id FROM equipment WHERE id = ?').get(payload.equipmentId);
  if (!equipment) throw publicError('Equipamento não encontrado.', 404);
  db.prepare(`
    INSERT INTO maintenance (id, equipment_id, service_date, next_review, service, notes, status_after)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id('mnt'), payload.equipmentId, payload.date, payload.nextReview, payload.service, payload.notes, payload.statusAfter);
  db.prepare(`
    UPDATE equipment SET next_review = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(payload.nextReview, payload.statusAfter, payload.equipmentId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

app.post('/api/admin/maintenance', (req, res) => {
  try {
    const payload = {
      equipmentId: cleanText(req.body.equipmentId, 100),
      date: cleanText(req.body.date, 20),
      nextReview: cleanText(req.body.nextReview, 20),
      service: cleanText(req.body.service, 500),
      notes: cleanText(req.body.notes, 3000),
      statusAfter: ['disponivel','manutencao','indisponivel'].includes(req.body.statusAfter) ? req.body.statusAfter : 'disponivel'
    };
    if (!payload.equipmentId || !/^\d{4}-\d{2}-\d{2}$/.test(payload.date) || !/^\d{4}-\d{2}-\d{2}$/.test(payload.nextReview) || !payload.service) {
      throw publicError('Preencha equipamento, datas e serviço realizado.');
    }
    createMaintenance(payload);
    res.status(201).json({ ok: true });
  } catch (error) {
    handleError(res, error, 'Não foi possível registrar a manutenção.');
  }
});

app.get('/api/admin/loyalty', (req, res) => {
  expireLoyaltyCoupons();
  const clients = db.prepare(`
    SELECT c.id, c.name, c.cpf, c.phone, c.email,
      COALESCE(a.points, 0) AS points,
      COALESCE(a.level, 'Bronze') AS level,
      COALESCE(a.completed_rentals, 0) AS completedRentals,
      (SELECT COUNT(*) FROM loyalty_coupons cp WHERE cp.client_id = c.id AND cp.status = 'ativo') AS activeCoupons
    FROM clients c
    LEFT JOIN loyalty_accounts a ON a.client_id = c.id
    ORDER BY points DESC, completedRentals DESC, c.name
  `).all();
  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(points), 0) AS distributedPoints,
      COUNT(DISTINCT client_id) AS rewardedClients
    FROM loyalty_transactions
  `).get();
  const activeCoupons = Number(db.prepare("SELECT COUNT(*) AS total FROM loyalty_coupons WHERE status = 'ativo'").get().total);
  const topClients = clients.slice(0, 5);
  res.json({ clients, topClients, distributedPoints: Number(totals.distributedPoints), rewardedClients: Number(totals.rewardedClients), activeCoupons });
});

app.get('/api/admin/assistant', (req, res) => {
  try {
    res.json({ services: assistantData(true) });
  } catch (error) {
    handleError(res, error, 'Não foi possível carregar as configurações do assistente.');
  }
});

app.patch('/api/admin/assistant/services/:id', (req, res) => {
  try {
    const service = db.prepare('SELECT id FROM assistant_services WHERE id = ?').get(req.params.id);
    if (!service) throw publicError('Serviço não encontrado.', 404);
    const active = req.body.active === false || req.body.active === 0 ? 0 : 1;
    db.prepare('UPDATE assistant_services SET active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(active, req.params.id);
    res.json({ ok: true });
  } catch (error) { handleError(res, error); }
});

app.patch('/api/admin/assistant/packages/:id', (req, res) => {
  try {
    const pack = db.prepare('SELECT id FROM rental_packages WHERE id = ?').get(req.params.id);
    if (!pack) throw publicError('Pacote não encontrado.', 404);
    const active = req.body.active === false || req.body.active === 0 ? 0 : 1;
    const discount = Math.max(0, Math.min(30, parseNumber(req.body.discountPercent, 0)));
    db.prepare('UPDATE rental_packages SET active=?, discount_percent=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(active, discount, req.params.id);
    res.json({ ok: true });
  } catch (error) { handleError(res, error); }
});

app.get('/api/admin/clients', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT c.id, c.name, c.cpf AS document, c.phone, c.email, c.client_type AS clientType,
        c.company_name AS companyName, c.trade_name AS tradeName, c.city, c.state,
        COUNT(DISTINCT r.id) AS reservations,
        COALESCE(SUM(CASE WHEN p.status='pago' THEN p.amount ELSE 0 END), 0) AS totalPaid,
        COALESCE(la.points, 0) AS points, COALESCE(la.level, 'Bronze') AS level
      FROM clients c
      LEFT JOIN reservations r ON r.client_id = c.id
      LEFT JOIN payments p ON p.reservation_id = r.id
      LEFT JOIN loyalty_accounts la ON la.client_id = c.id
      GROUP BY c.id ORDER BY datetime(c.created_at) DESC
    `).all().map(row => ({ ...row, reservations: Number(row.reservations), totalPaid: Number(row.totalPaid), points: Number(row.points) }));
    res.json(rows);
  } catch (error) {
    handleError(res, error, 'Não foi possível carregar os clientes.');
  }
});

app.get('/api/admin/dashboard', (req, res) => {
  const equipment = equipmentRows();
  const reservations = reservationRows();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const reviews = equipment.filter(item => {
    const days = Math.ceil((new Date(`${item.nextReview}T00:00:00`) - today) / 86400000);
    return days <= 15;
  });
  const activeReservations = reservations.filter(item => ['confirmada', 'em_uso'].includes(item.status));
  const validReservations = reservations.filter(item => item.status !== 'cancelada');
  const paidReservations = validReservations.filter(item => item.paymentStatus === 'pago');
  const overdue = reservations.filter(item => item.status === 'em_uso' && new Date(item.end) < new Date());
  const pendingPayments = validReservations.filter(item => item.paymentStatus !== 'pago');

  const revenue = paidReservations.reduce((sum, item) => sum + item.payNow, 0);
  const pendingValue = pendingPayments.reduce((sum, item) => sum + item.payNow, 0);
  const reservationRevenueTotal = validReservations.reduce((sum, item) => sum + item.payNow, 0);
  const averageTicket = validReservations.length ? reservationRevenueTotal / validReservations.length : 0;
  const payables = accountsPayableRows();
  const accountsPayable = payables.filter(item => item.status === 'pendente').reduce((sum, item) => sum + item.amount, 0);
  const accountsReceivable = pendingValue;
  const unitSummary = db.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN status='disponivel' THEN 1 ELSE 0 END) AS available,
    SUM(CASE WHEN status IN ('manutencao','indisponivel') THEN 1 ELSE 0 END) AS maintenance
    FROM equipment_units`).get();
  const totalUnits = Number(unitSummary.total || 0) || equipment.reduce((sum, item) => sum + Number(item.total), 0);
  const available = Number(unitSummary.available || 0);
  const maintenanceUnits = Number(unitSummary.maintenance || 0);
  const clientsCount = Number(db.prepare('SELECT COUNT(*) AS total FROM clients').get().total);

  const categoryStockMap = new Map();
  for (const item of equipment) {
    const current = categoryStockMap.get(item.category) || { label: item.category, total: 0, available: 0 };
    current.total += Number(item.total);
    if (item.status === 'disponivel') current.available += Number(item.total);
    categoryStockMap.set(item.category, current);
  }
  const categoryStock = [...categoryStockMap.values()].sort((a, b) => b.total - a.total);

  const statusLabels = { pendente: 'Pendentes', confirmada: 'Confirmadas', em_uso: 'Em uso', concluida: 'Concluídas', cancelada: 'Canceladas' };
  const statusCounts = Object.entries(statusLabels).map(([status, label]) => ({
    status,
    label,
    value: reservations.filter(item => item.status === status).length
  }));

  const monthlyRevenue = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setDate(1);
    date.setHours(0, 0, 0, 0);
    date.setMonth(date.getMonth() - offset);
    const year = date.getFullYear();
    const month = date.getMonth();
    const value = paidReservations.reduce((sum, item) => {
      const reference = new Date(item.paidAt || item.createdAt);
      return reference.getFullYear() === year && reference.getMonth() === month
        ? sum + item.payNow
        : sum;
    }, 0);
    monthlyRevenue.push({
      label: date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
      value: Number(value.toFixed(2))
    });
  }

  const topMap = new Map();
  for (const reservation of validReservations) {
    for (const item of reservation.items || []) {
      const current = topMap.get(item.equipmentId) || { id: item.equipmentId, label: item.name, quantity: 0, revenue: 0 };
      current.quantity += Number(item.quantity);
      current.revenue += Number(item.dailyRate) * Number(item.quantity) * Number(reservation.dailyCount);
      topMap.set(item.equipmentId, current);
    }
  }
  const topEquipment = [...topMap.values()].sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue).slice(0, 6);

  const alerts = [
    ...overdue.slice(0, 4).map(item => ({
      type: 'danger',
      title: `Devolução atrasada — ${item.contract}`,
      detail: `${item.clientName} · ${item.equipmentName}`,
      reservationId: item.id
    })),
    ...pendingPayments.filter(item => ['confirmada', 'em_uso'].includes(item.status)).slice(0, 4).map(item => ({
      type: 'warning',
      title: `Pagamento pendente — ${item.contract}`,
      detail: `${item.clientName} · R$ ${item.payNow.toFixed(2).replace('.', ',')}`,
      reservationId: item.id
    }))
  ].slice(0, 6);

  res.json({
    totalUnits,
    available,
    maintenanceUnits,
    active: activeReservations.length,
    revenue,
    pendingValue,
    accountsReceivable,
    accountsPayable,
    averageTicket,
    overdueCount: overdue.length,
    clientsCount,
    totalReservations: reservations.length,
    reviews,
    recent: reservations.slice(0, 5),
    categoryStock,
    statusCounts,
    monthlyRevenue,
    topEquipment,
    alerts
  });
});




function accountsPayableRows() {
  return db.prepare(`
    SELECT id, description, category, supplier, due_date, amount, status, paid_at, notes, created_at, updated_at
    FROM accounts_payable
    ORDER BY date(due_date) ASC, description ASC
  `).all().map(row => ({
    id: row.id,
    description: row.description,
    category: row.category,
    supplier: row.supplier || '',
    dueDate: row.due_date,
    amount: Number(row.amount || 0),
    status: row.status,
    paidAt: row.paid_at,
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

function goalProgressRow(goal) {
  const [year, month] = String(goal.period_month).split('-').map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  const reservations = reservationRows().filter(item => {
    const created = new Date(item.createdAt);
    return created >= start && created < end && item.status !== 'cancelada';
  });
  let current = 0;
  if (goal.metric === 'revenue') {
    current = reservations.filter(item => item.paymentStatus === 'pago').reduce((sum, item) => sum + item.payNow, 0);
  } else if (goal.metric === 'reservations') {
    current = reservations.length;
  } else if (goal.metric === 'clients') {
    current = Number(db.prepare(`SELECT COUNT(*) AS total FROM clients WHERE datetime(created_at) >= ? AND datetime(created_at) < ?`).get(start.toISOString(), end.toISOString()).total || 0);
  } else if (goal.metric === 'on_time_rate') {
    const completed = reservations.filter(item => item.status === 'concluida');
    current = completed.length ? (completed.filter(item => new Date(item.updatedAt) <= new Date(item.end)).length / completed.length) * 100 : 0;
  }
  return { ...goal, targetValue: Number(goal.target_value), currentValue: Number(current.toFixed(2)), progress: Math.min(100, Number(((current / Number(goal.target_value)) * 100).toFixed(1))) };
}

app.get('/api/admin/goals', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM admin_goals ORDER BY period_month DESC, datetime(created_at) DESC').all().map(goalProgressRow);
    res.json(rows);
  } catch (error) { handleError(res, error, 'Não foi possível carregar as metas.'); }
});

app.post('/api/admin/goals', (req, res) => {
  try {
    const title = cleanText(req.body.title, 120);
    const metric = cleanText(req.body.metric, 40);
    const targetValue = Number(req.body.targetValue);
    const periodMonth = cleanText(req.body.periodMonth, 7);
    if (!title || !['revenue','reservations','clients','on_time_rate'].includes(metric) || !(targetValue > 0) || !/^\d{4}-\d{2}$/.test(periodMonth)) throw publicError('Preencha corretamente a meta.');
    const goalId = id('goal');
    db.prepare('INSERT INTO admin_goals (id,title,metric,target_value,period_month) VALUES (?,?,?,?,?)').run(goalId,title,metric,targetValue,periodMonth);
    res.status(201).json(goalProgressRow(db.prepare('SELECT * FROM admin_goals WHERE id=?').get(goalId)));
  } catch (error) { handleError(res, error, 'Não foi possível salvar a meta.'); }
});

app.delete('/api/admin/goals/:id', (req, res) => {
  try { db.prepare('DELETE FROM admin_goals WHERE id=?').run(req.params.id); res.json({ ok: true }); }
  catch (error) { handleError(res, error, 'Não foi possível excluir a meta.'); }
});


app.get('/api/admin/deliveries', (req, res) => {
  try {
    res.json(deliveryRows());
  } catch (error) {
    handleError(res, error, 'Não foi possível carregar as entregas.');
  }
});

app.patch('/api/admin/deliveries/:reservationId', (req, res) => {
  try {
    const control = ensureDeliveryControl(req.params.reservationId);
    if (!control) throw publicError('Essa reserva não possui entrega cadastrada.', 404);
    const allowedDelivery = new Set(['aguardando','em_rota','entregue','cancelado']);
    const allowedPickup = new Set(['pendente','agendado','em_rota','recolhido','cancelado']);
    const deliveryStatus = allowedDelivery.has(req.body.deliveryStatus) ? req.body.deliveryStatus : control.delivery_status;
    const pickupStatus = allowedPickup.has(req.body.pickupStatus) ? req.body.pickupStatus : control.pickup_status;
    const scheduledAt = isValidDate(req.body.scheduledAt) ? new Date(req.body.scheduledAt).toISOString() : null;
    const pickupScheduledAt = isValidDate(req.body.pickupScheduledAt) ? new Date(req.body.pickupScheduledAt).toISOString() : null;
    const deliveredAt = deliveryStatus === 'entregue' ? (control.delivered_at || new Date().toISOString()) : null;
    const pickedUpAt = pickupStatus === 'recolhido' ? (control.picked_up_at || new Date().toISOString()) : null;
    db.prepare(`
      UPDATE delivery_controls
      SET delivery_status=?, pickup_status=?, scheduled_at=?, delivered_at=?, pickup_scheduled_at=?, picked_up_at=?,
          responsible_name=?, vehicle_plate=?, tracking_notes=?, updated_at=CURRENT_TIMESTAMP
      WHERE reservation_id=?
    `).run(
      deliveryStatus, pickupStatus, scheduledAt, deliveredAt, pickupScheduledAt, pickedUpAt,
      cleanText(req.body.responsibleName, 180), cleanText(req.body.vehiclePlate, 30).toUpperCase(),
      cleanText(req.body.trackingNotes, 2000), req.params.reservationId
    );
    res.json(deliveryRows().find(item => item.id === req.params.reservationId));
  } catch (error) { handleError(res, error, 'Não foi possível atualizar a entrega.'); }
});


app.get('/api/admin/finance', (req, res) => {
  const reservations = reservationRows().filter(item => item.status !== 'cancelada');
  const rows = reservations.map(item => ({ ...item, lateFee: calculateLateFee(item) }));
  const received = rows.filter(item => item.paymentStatus === 'pago').reduce((sum, item) => sum + item.payNow, 0);
  const pending = rows.filter(item => item.paymentStatus !== 'pago').reduce((sum, item) => sum + item.payNow, 0);
  const deposits = rows.filter(item => ['confirmada','em_uso'].includes(item.status)).reduce((sum, item) => sum + item.deposit, 0);
  const lateFees = rows.reduce((sum, item) => sum + item.lateFee, 0);
  const reservationRevenueTotal = rows.reduce((sum, item) => sum + item.payNow, 0);
  const averageTicket = rows.length ? reservationRevenueTotal / rows.length : 0;
  const receivableRows = rows
    .filter(item => item.paymentStatus !== 'pago')
    .map(item => ({
      id: item.id,
      contract: item.contract,
      clientName: item.clientName,
      description: `Reserva ${item.contract}`,
      dueDate: item.start,
      amount: item.payNow,
      status: item.paymentStatus,
      reservationStatus: item.status
    }));
  const payableRows = accountsPayableRows();
  const accountsPayable = payableRows.filter(item => item.status === 'pendente').reduce((sum, item) => sum + item.amount, 0);
  const paidExpenses = payableRows.filter(item => item.status === 'pago').reduce((sum, item) => sum + item.amount, 0);
  const expectedBalance = received + pending - accountsPayable;
  res.json({
    received,
    pending,
    deposits,
    lateFees,
    accountsReceivable: pending,
    accountsPayable,
    paidExpenses,
    averageTicket,
    expectedBalance,
    receivableRows,
    payableRows,
    rows
  });
});

app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  maxAge: 0,
  etag: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store');
  }
}));

app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Rota não encontrada.' });
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  handleError(res, error);
});

app.listen(PORT, () => {
  console.log(`Casa dos materiais disponível em http://localhost:${PORT}`);
  console.log(`Painel administrativo: http://localhost:${PORT}/admin.html`);
});
