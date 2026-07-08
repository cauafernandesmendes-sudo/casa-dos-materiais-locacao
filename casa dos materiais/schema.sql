PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS administrators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  cpf TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  cep TEXT NOT NULL,
  address TEXT NOT NULL,
  neighborhood TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  address_number TEXT,
  complement TEXT,
  client_type TEXT NOT NULL DEFAULT 'PF' CHECK(client_type IN ('PF','PJ')),
  company_name TEXT,
  trade_name TEXT,
  password_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS loyalty_accounts (
  client_id INTEGER PRIMARY KEY,
  points INTEGER NOT NULL DEFAULT 0 CHECK(points >= 0),
  level TEXT NOT NULL DEFAULT 'Bronze' CHECK(level IN ('Bronze','Prata','Ouro','Obra Premium')),
  completed_rentals INTEGER NOT NULL DEFAULT 0 CHECK(completed_rentals >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id TEXT PRIMARY KEY,
  client_id INTEGER NOT NULL,
  reservation_id TEXT NOT NULL UNIQUE,
  points INTEGER NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS loyalty_coupons (
  id TEXT PRIMARY KEY,
  client_id INTEGER NOT NULL,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  discount_percent REAL NOT NULL DEFAULT 10 CHECK(discount_percent > 0 AND discount_percent <= 100),
  status TEXT NOT NULL DEFAULT 'ativo' CHECK(status IN ('ativo','utilizado','expirado')),
  expires_at TEXT NOT NULL,
  used_reservation_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (used_reservation_id) REFERENCES reservations(id) ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS equipment (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0 CHECK(total >= 0),
  status TEXT NOT NULL DEFAULT 'disponivel' CHECK(status IN ('disponivel','manutencao','indisponivel')),
  daily REAL NOT NULL DEFAULT 0 CHECK(daily >= 0),
  deposit REAL NOT NULL DEFAULT 0 CHECK(deposit >= 0),
  power TEXT,
  weight TEXT,
  serial TEXT NOT NULL UNIQUE,
  next_review TEXT NOT NULL,
  accessories TEXT NOT NULL DEFAULT '[]',
  image TEXT,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS assistant_services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '🧰',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assistant_recommendations (
  service_id TEXT NOT NULL,
  equipment_id TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (service_id, equipment_id),
  FOREIGN KEY (service_id) REFERENCES assistant_services(id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rental_packages (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  discount_percent REAL NOT NULL DEFAULT 0 CHECK(discount_percent >= 0 AND discount_percent <= 100),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (service_id) REFERENCES assistant_services(id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rental_package_items (
  package_id TEXT NOT NULL,
  equipment_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0),
  PRIMARY KEY (package_id, equipment_id),
  FOREIGN KEY (package_id) REFERENCES rental_packages(id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  contract TEXT NOT NULL UNIQUE,
  client_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','confirmada','em_uso','concluida','cancelada')),
  payment_status TEXT NOT NULL DEFAULT 'pendente' CHECK(payment_status IN ('pendente','pago','estornado')),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  accessory TEXT,
  notes TEXT,
  delivery INTEGER NOT NULL DEFAULT 0 CHECK(delivery IN (0,1)),
  payment_method TEXT NOT NULL,
  daily_count INTEGER NOT NULL CHECK(daily_count > 0),
  rental REAL NOT NULL CHECK(rental >= 0),
  discount REAL NOT NULL DEFAULT 0 CHECK(discount >= 0),
  coupon_code TEXT,
  package_id TEXT,
  package_name TEXT,
  package_discount REAL NOT NULL DEFAULT 0 CHECK(package_discount >= 0),
  business_discount REAL NOT NULL DEFAULT 0 CHECK(business_discount >= 0),
  service_id TEXT,
  freight REAL NOT NULL DEFAULT 0 CHECK(freight >= 0),
  deposit REAL NOT NULL DEFAULT 0 CHECK(deposit >= 0),
  total REAL NOT NULL CHECK(total >= 0),
  signature TEXT NOT NULL,
  signed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS reservation_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id TEXT NOT NULL,
  equipment_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  daily_rate REAL NOT NULL CHECK(daily_rate >= 0),
  accessory TEXT,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON UPDATE CASCADE ON DELETE RESTRICT
);


CREATE TABLE IF NOT EXISTS delivery_controls (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL UNIQUE,
  delivery_status TEXT NOT NULL DEFAULT 'aguardando' CHECK(delivery_status IN ('aguardando','em_rota','entregue','cancelado')),
  pickup_status TEXT NOT NULL DEFAULT 'pendente' CHECK(pickup_status IN ('pendente','agendado','em_rota','recolhido','cancelado')),
  scheduled_at TEXT,
  delivered_at TEXT,
  pickup_scheduled_at TEXT,
  picked_up_at TEXT,
  responsible_name TEXT,
  vehicle_plate TEXT,
  tracking_notes TEXT,
  map_query TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL UNIQUE,
  method TEXT NOT NULL,
  amount REAL NOT NULL CHECK(amount >= 0),
  status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','pago','estornado')),
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON UPDATE CASCADE ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS equipment_units (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL,
  asset_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  serial_number TEXT,
  status TEXT NOT NULL DEFAULT 'disponivel' CHECK(status IN ('disponivel','reservado','em_uso','manutencao','indisponivel')),
  last_review TEXT,
  next_review TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reservation_unit_assignments (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL,
  equipment_unit_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at TEXT,
  UNIQUE(reservation_id, equipment_unit_id),
  FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (equipment_unit_id) REFERENCES equipment_units(id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS maintenance (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL,
  service_date TEXT NOT NULL,
  next_review TEXT NOT NULL,
  service TEXT NOT NULL,
  notes TEXT,
  status_after TEXT NOT NULL CHECK(status_after IN ('disponivel','manutencao','indisponivel')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS inspections (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL,
  inspection_type TEXT NOT NULL CHECK(inspection_type IN ('retirada','devolucao')),
  condition_status TEXT NOT NULL CHECK(condition_status IN ('bom','atencao','avariado')),
  notes TEXT,
  checklist_json TEXT NOT NULL DEFAULT '{}',
  photos_json TEXT NOT NULL DEFAULT '[]',
  responsible_name TEXT,
  inspected_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL UNIQUE,
  contract_number TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  signed_name TEXT NOT NULL,
  signed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reservation_period ON reservations(start_at, end_at, status);
CREATE INDEX IF NOT EXISTS idx_reservation_client ON reservations(client_id);
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_item_equipment ON reservation_items(equipment_id, reservation_id);

CREATE INDEX IF NOT EXISTS idx_equipment_units_equipment ON equipment_units(equipment_id, status);
CREATE INDEX IF NOT EXISTS idx_unit_assignments_reservation ON reservation_unit_assignments(reservation_id, released_at);
CREATE INDEX IF NOT EXISTS idx_unit_assignments_unit ON reservation_unit_assignments(equipment_unit_id, released_at);

CREATE INDEX IF NOT EXISTS idx_maintenance_equipment ON maintenance(equipment_id, service_date);
CREATE INDEX IF NOT EXISTS idx_inspections_reservation ON inspections(reservation_id, inspection_type);

CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_client ON loyalty_transactions(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_loyalty_coupons_client ON loyalty_coupons(client_id, status, expires_at);


CREATE TABLE IF NOT EXISTS accounts_payable (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  supplier TEXT,
  due_date TEXT NOT NULL,
  amount REAL NOT NULL CHECK(amount >= 0),
  status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','pago','cancelado')),
  paid_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_accounts_payable_status_due ON accounts_payable(status, due_date);

CREATE INDEX IF NOT EXISTS idx_assistant_service_category ON assistant_services(category, active, sort_order);
CREATE INDEX IF NOT EXISTS idx_packages_service ON rental_packages(service_id, active);

CREATE TABLE IF NOT EXISTS admin_goals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  metric TEXT NOT NULL CHECK(metric IN ('revenue','reservations','clients','on_time_rate')),
  target_value REAL NOT NULL CHECK(target_value > 0),
  period_month TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
