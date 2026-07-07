'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const databaseDir = path.join(__dirname, 'database');
const databasePath = path.join(databaseDir, 'casa-dos-materiais.db');
const schemaPath = path.join(__dirname, 'schema.sql');

fs.mkdirSync(databaseDir, { recursive: true });

const db = new DatabaseSync(databasePath);
db.exec(fs.readFileSync(schemaPath, 'utf8'));

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(item => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Migra bancos criados por versões anteriores sem apagar dados existentes.
ensureColumn('reservations', 'discount', 'REAL NOT NULL DEFAULT 0');
ensureColumn('reservations', 'coupon_code', 'TEXT');
ensureColumn('reservations', 'package_id', 'TEXT');
ensureColumn('reservations', 'package_name', 'TEXT');
ensureColumn('reservations', 'package_discount', 'REAL NOT NULL DEFAULT 0');
ensureColumn('reservations', 'service_id', 'TEXT');
ensureColumn('reservations', 'business_discount', 'REAL NOT NULL DEFAULT 0');
ensureColumn('clients', 'address_number', 'TEXT');
ensureColumn('clients', 'complement', 'TEXT');
ensureColumn('clients', 'client_type', "TEXT NOT NULL DEFAULT 'PF'");
ensureColumn('clients', 'company_name', 'TEXT');
ensureColumn('clients', 'trade_name', 'TEXT');
ensureColumn('clients', 'password_hash', 'TEXT');
ensureColumn('inspections', 'checklist_json', "TEXT NOT NULL DEFAULT '{}'");
ensureColumn('inspections', 'photos_json', "TEXT NOT NULL DEFAULT '[]'");
ensureColumn('inspections', 'responsible_name', 'TEXT');
db.exec('CREATE INDEX IF NOT EXISTS idx_clients_type ON clients(client_type)');
db.exec('CREATE INDEX IF NOT EXISTS idx_delivery_controls_reservation ON delivery_controls(reservation_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_accounts_payable_status_due ON accounts_payable(status, due_date)');

function isoDateOffset(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthDate(day) {
  const date = new Date();
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setHours(12, 0, 0, 0);
  date.setDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedValue) {
  try {
    const [salt, savedHash] = String(storedValue || '').split(':');
    if (!salt || !savedHash) return false;
    const hash = crypto.scryptSync(password, salt, 64);
    const savedBuffer = Buffer.from(savedHash, 'hex');
    return savedBuffer.length === hash.length && crypto.timingSafeEqual(savedBuffer, hash);
  } catch {
    return false;
  }
}

const initialEquipment = [
  { id: 'eq-betoneira', name: 'Betoneira 400L', category: 'Construção', total: 5, status: 'disponivel', daily: 180, deposit: 500, power: '2 CV', weight: '145 kg', serial: 'BET-400', nextReview: isoDateOffset(8), accessories: ['Extensão 20m', 'Carrinho de mão', 'EPI básico'], image: 'assets/photos/betoneira-400.jpg', description: 'Betoneira robusta para preparo de concreto e argamassa em obras de pequeno e médio porte.' },
  { id: 'eq-betoneira-250', name: 'Betoneira 250L', category: 'Construção', total: 4, status: 'disponivel', daily: 145, deposit: 420, power: '1,5 CV', weight: '118 kg', serial: 'BET-250', nextReview: isoDateOffset(32), accessories: ['Extensão 20m', 'Carrinho de mão', 'EPI básico'], image: 'assets/photos/betoneira-250.jpg', description: 'Modelo compacto e fácil de transportar, indicado para reformas e pequenos concretos.' },
  { id: 'eq-martelete', name: 'Martelete Demolidor 10 kg', category: 'Construção', total: 6, status: 'disponivel', daily: 115, deposit: 350, power: '1.500 W', weight: '10 kg', serial: 'MAR-10K', nextReview: isoDateOffset(25), accessories: ['Ponteiro', 'Talhadeira', 'Óculos de proteção'], image: 'assets/photos/martelete.jpg', description: 'Equipamento de alto impacto para demolições, remoção de pisos e abertura de canaletas.' },
  { id: 'eq-furadeira', name: 'Furadeira de Impacto 1/2 pol.', category: 'Construção', total: 10, status: 'disponivel', daily: 58, deposit: 180, power: '850 W', weight: '2,4 kg', serial: 'FUR-850', nextReview: isoDateOffset(40), accessories: ['Jogo de brocas', 'Limitador de profundidade', 'Mala de transporte'], image: 'assets/photos/furadeira.jpg', description: 'Furadeira reversível com impacto para concreto, madeira, metal e alvenaria.' },
  { id: 'eq-cortador-piso', name: 'Cortador de Piso a Gasolina', category: 'Construção', total: 3, status: 'disponivel', daily: 250, deposit: 850, power: '5,5 HP', weight: '68 kg', serial: 'COR-PIS-55', nextReview: isoDateOffset(11), accessories: ['Disco diamantado', 'Reservatório de água', 'Protetor auricular'], image: 'assets/photos/cortador-piso.jpg', description: 'Cortador profissional para juntas e cortes precisos em pisos de concreto e asfalto.' },
  { id: 'eq-compactador', name: 'Compactador de Solo', category: 'Construção', total: 4, status: 'disponivel', daily: 220, deposit: 700, power: 'Motor 4T', weight: '72 kg', serial: 'COM-4T', nextReview: isoDateOffset(-2), accessories: ['Galão homologado', 'Protetor auricular'], image: 'assets/photos/compactador-solo.jpg', description: 'Compactador tipo sapo indicado para valas, fundações e solos coesivos.' },
  { id: 'eq-placa', name: 'Placa Vibratória', category: 'Construção', total: 5, status: 'disponivel', daily: 200, deposit: 650, power: '5,5 HP', weight: '88 kg', serial: 'PLV-55', nextReview: isoDateOffset(13), accessories: ['Reservatório de água', 'EPI básico'], image: 'assets/photos/placa-vibratoria.jpg', description: 'Placa vibratória para compactação de asfalto, brita, areia e pavimentos intertravados.' },
  { id: 'eq-andaime', name: 'Andaime Tubular 1,0 x 1,5 m', category: 'Construção', total: 30, status: 'disponivel', daily: 28, deposit: 120, power: 'Aço galvanizado', weight: '16 kg/módulo', serial: 'AND-1015', nextReview: isoDateOffset(45), accessories: ['Rodízios', 'Plataforma', 'Guarda-corpo'], image: 'assets/photos/andaime.jpg', description: 'Módulo de andaime tubular com encaixe rápido para serviços em altura.' },
  { id: 'eq-escada-extensiva', name: 'Escada Extensiva 7,2 m', category: 'Construção', total: 8, status: 'disponivel', daily: 48, deposit: 180, power: 'Alumínio', weight: '17 kg', serial: 'ESC-72M', nextReview: isoDateOffset(70), accessories: ['Cinta de amarração', 'Sapatas antiderrapantes'], image: 'assets/photos/escada-extensiva.jpg', description: 'Escada extensiva em alumínio para serviços de fachada, telhado e instalações em altura.' },
  { id: 'eq-serra-circular', name: 'Serra Circular 7 1/4 pol.', category: 'Construção', total: 7, status: 'disponivel', daily: 78, deposit: 240, power: '1.800 W', weight: '5,2 kg', serial: 'SER-CIR-1800', nextReview: isoDateOffset(34), accessories: ['Disco para madeira', 'Guia paralela', 'Óculos de proteção'], image: 'assets/photos/serra-circular.jpg', description: 'Serra portátil para cortes retos em madeira, compensados, MDF e painéis de obra.' },
  { id: 'eq-serra-marmore', name: 'Serra Mármore 4 3/8 pol.', category: 'Construção', total: 6, status: 'disponivel', daily: 69, deposit: 210, power: '1.300 W', weight: '3,1 kg', serial: 'SER-MAR-1300', nextReview: isoDateOffset(24), accessories: ['Disco diamantado', 'Chave de troca', 'Protetor auricular'], image: 'assets/photos/serra-ceramica.jpg', description: 'Indicada para cortes em cerâmica, piso, porcelanato e acabamentos de obra.' },

  { id: 'eq-lavadora', name: 'Lavadora de Alta Pressão', category: 'Limpeza', total: 6, status: 'disponivel', daily: 95, deposit: 280, power: '2.100 W / 2.100 PSI', weight: '18 kg', serial: 'LAV-2100', nextReview: isoDateOffset(27), accessories: ['Mangueira 8m', 'Bico leque', 'Aplicador de detergente'], image: 'assets/photos/lavadora.jpg', description: 'Lavadora para limpeza pesada de fachadas, pisos, máquinas, veículos e áreas de obra.' },
  { id: 'eq-aspirador-industrial', name: 'Aspirador Industrial 50L', category: 'Limpeza', total: 5, status: 'disponivel', daily: 110, deposit: 320, power: '1.400 W', weight: '19 kg', serial: 'ASP-50L', nextReview: isoDateOffset(29), accessories: ['Mangueira reforçada', 'Bocal para piso', 'Filtro para pó'], image: 'assets/photos/aspirador-industrial.jpg', description: 'Aspirador de sólidos e líquidos para limpeza pós-obra, oficinas e áreas industriais.' },
  { id: 'eq-enceradeira', name: 'Enceradeira Industrial 350 mm', category: 'Limpeza', total: 3, status: 'disponivel', daily: 135, deposit: 380, power: '1.200 W', weight: '28 kg', serial: 'ENC-350', nextReview: isoDateOffset(22), accessories: ['Escova de nylon', 'Suporte para disco', 'Disco de polimento'], image: 'assets/photos/enceradeira-industrial.jpg', description: 'Enceradeira indicada para lavagem, polimento e recuperação de brilho em pisos industriais e comerciais.' },

  { id: 'eq-cortadora-grama', name: 'Cortadora de Grama 6 HP', category: 'Jardinagem', total: 4, status: 'disponivel', daily: 105, deposit: 260, power: '6 HP', weight: '31 kg', serial: 'COR-GRA-6HP', nextReview: isoDateOffset(19), accessories: ['Coletor traseiro', 'Galão homologado', 'EPI básico'], image: 'assets/photos/cortadora-grama.jpg', description: 'Cortadora para manutenção de jardins, gramados residenciais e áreas verdes de condomínios.' },
  { id: 'eq-eletroserra', name: 'Eletroserra 18 pol.', category: 'Jardinagem', total: 4, status: 'disponivel', daily: 92, deposit: 280, power: '2.000 W', weight: '5,5 kg', serial: 'ELE-SER-18', nextReview: isoDateOffset(17), accessories: ['Sabre 18 pol.', 'Corrente reserva', 'Óleo lubrificante'], image: 'assets/photos/eletroserra.jpg', description: 'Eletroserra para cortes em troncos, podas e pequenas derrubadas controladas.' },
  { id: 'eq-rocadeira', name: 'Roçadeira Lateral 2T', category: 'Jardinagem', total: 5, status: 'disponivel', daily: 98, deposit: 300, power: '42,7 cc', weight: '7,6 kg', serial: 'ROC-427', nextReview: isoDateOffset(28), accessories: ['Carretel com nylon', 'Lâmina 3 pontas', 'Protetor facial'], image: 'assets/photos/rocadeira.jpg', description: 'Roçadeira para capim alto, limpeza de terrenos e acabamento de bordas.' },
  { id: 'eq-soprador', name: 'Soprador de Folhas', category: 'Jardinagem', total: 4, status: 'disponivel', daily: 76, deposit: 220, power: '1,1 HP', weight: '4,4 kg', serial: 'SOP-FOL-11', nextReview: isoDateOffset(31), accessories: ['Bico concentrador', 'Galão homologado'], image: 'assets/photos/soprador-folhas.jpg', description: 'Soprador portátil para remoção de folhas, resíduos leves e secagem rápida de áreas externas.' },

  { id: 'eq-compressor-ar', name: 'Compressor de Ar 50L', category: 'Pintura', total: 4, status: 'disponivel', daily: 135, deposit: 420, power: '2 HP / 50 L', weight: '42 kg', serial: 'COM-AR-50', nextReview: isoDateOffset(38), accessories: ['Mangueira 10m', 'Bico soprador', 'Regulador de pressão'], image: 'assets/photos/compressor-real-50l.jpg', description: 'Compressor portátil para pintura, limpeza e uso com ferramentas pneumáticas leves.' },
  { id: 'eq-kit-pintura', name: 'Kit de Pincéis e Rolos Profissionais', category: 'Pintura', total: 8, status: 'disponivel', daily: 45, deposit: 120, power: 'Manual', weight: '3 kg', serial: 'KIT-PIN', nextReview: isoDateOffset(90), accessories: ['Pincéis', 'Rolos', 'Bandeja', 'Extensor'], image: 'assets/photos/kit-pinceis-rolos-vivo.jpg', description: 'Kit com pincel, rolos e bandeja para aplicação de tintas em paredes, tetos e portas.' },
  { id: 'eq-lixadeira-orbital', name: 'Lixadeira Orbital', category: 'Pintura', total: 7, status: 'disponivel', daily: 62, deposit: 180, power: '320 W', weight: '1,9 kg', serial: 'LIX-ORB-320', nextReview: isoDateOffset(36), accessories: ['Lixas grão 80/120/180', 'Coletor de pó'], image: 'assets/photos/lixadeira-orbital.jpg', description: 'Lixadeira orbital para preparação de superfícies, massa corrida, madeira e acabamentos de pintura.' },
  { id: 'eq-pistola-airless', name: 'Pistola de Pintura Airless', category: 'Pintura', total: 3, status: 'disponivel', daily: 165, deposit: 500, power: '900 W', weight: '14 kg', serial: 'PIN-AIR-900', nextReview: isoDateOffset(20), accessories: ['Mangueira 15m', 'Bico 517', 'Filtro reserva'], image: 'assets/photos/pistola-airless-real.jpg', description: 'Sistema airless para pintura rápida de paredes, fachadas, estruturas e grandes superfícies.' },
  { id: 'eq-extratora', name: 'Extratora Profissional 30L', category: 'Limpeza', total: 4, status: 'disponivel', daily: 125, deposit: 350, power: '1.600 W', weight: '24 kg', serial: 'EXT-30L', nextReview: isoDateOffset(44), accessories: ['Bico para estofado', 'Mangueira de extração', 'Bocal para carpetes'], image: 'assets/photos/extratora.jpg', description: 'Extratora para lavagem profunda de carpetes, estofados e bancos.' },
  { id: 'eq-aparador-cerca', name: 'Aparador de Cerca Viva', category: 'Jardinagem', total: 5, status: 'disponivel', daily: 72, deposit: 220, power: '650 W', weight: '4,2 kg', serial: 'APA-CER-650', nextReview: isoDateOffset(52), accessories: ['Protetor de lâmina', 'Extensão 20m', 'Óculos de proteção'], image: 'assets/photos/aparador-cerca.jpg', description: 'Aparador para acabamento de cercas vivas, arbustos e jardins.' },
  { id: 'eq-pistola-hvlp', name: 'Pistola de Pintura HVLP', category: 'Pintura', total: 8, status: 'disponivel', daily: 45, deposit: 140, power: 'Copo 600 ml', weight: '0,8 kg', serial: 'PIN-HVLP-600', nextReview: isoDateOffset(58), accessories: ['Bicos 1,4 e 1,7 mm', 'Copo 600 ml', 'Escova de limpeza'], image: 'assets/photos/pistola-hvlp-real.jpg', description: 'Pistola HVLP para pintura de móveis, portas, estruturas e pequenos acabamentos.' },

];

const initialAssistantServices = [
  { id: 'svc-concretagem', name: 'Concretagem e contrapiso', description: 'Mistura, transporte e compactação para concretagem, bases e contrapiso.', category: 'Construção', icon: '🏗️', order: 10, equipment: ['eq-betoneira', 'eq-betoneira-250', 'eq-compactador', 'eq-placa', 'eq-serra-marmore'] },
  { id: 'svc-demolicao', name: 'Demolição de paredes e pisos', description: 'Ferramentas de impacto e corte para demolições controladas e remoções.', category: 'Construção', icon: '🧱', order: 20, equipment: ['eq-martelete', 'eq-cortador-piso', 'eq-serra-marmore', 'eq-furadeira'] },
  { id: 'svc-corte-madeira', name: 'Corte de madeira e montagem', description: 'Soluções para corte, perfuração e montagem de estruturas e acabamentos.', category: 'Construção', icon: '🪚', order: 30, equipment: ['eq-serra-circular', 'eq-furadeira', 'eq-escada-extensiva', 'eq-andaime'] },
  { id: 'svc-altura', name: 'Trabalhos em altura', description: 'Acesso seguro para fachadas, telhados, instalações e manutenções elevadas.', category: 'Construção', icon: '🪜', order: 40, equipment: ['eq-andaime', 'eq-escada-extensiva', 'eq-furadeira'] },
  { id: 'svc-limpeza-pos-obra', name: 'Limpeza pós-obra', description: 'Remoção de pó, resíduos e sujeira pesada após reformas e construções.', category: 'Limpeza', icon: '🧹', order: 50, equipment: ['eq-aspirador-industrial', 'eq-lavadora', 'eq-enceradeira', 'eq-extratora'] },
  { id: 'svc-limpeza-pisos', name: 'Lavagem e recuperação de pisos', description: 'Lavagem, polimento e recuperação de pisos com acabamento profissional.', category: 'Limpeza', icon: '🫧', order: 60, equipment: ['eq-enceradeira', 'eq-extratora', 'eq-lavadora', 'eq-aspirador-industrial'] },
  { id: 'svc-corte-grama', name: 'Corte de grama e jardinagem', description: 'Manutenção de gramados, bordas e limpeza geral de áreas verdes.', category: 'Jardinagem', icon: '🌿', order: 70, equipment: ['eq-cortadora-grama', 'eq-rocadeira', 'eq-soprador', 'eq-aparador-cerca'] },
  { id: 'svc-poda', name: 'Poda e cerca-viva', description: 'Poda de árvores, corte de galhos e acabamento de cercas vivas e arbustos.', category: 'Jardinagem', icon: '🌳', order: 80, equipment: ['eq-eletroserra', 'eq-aparador-cerca', 'eq-escada-extensiva', 'eq-soprador'] },
  { id: 'svc-pintura', name: 'Pintura residencial', description: 'Preparação da superfície e aplicação de tinta em paredes, tetos e acabamentos.', category: 'Pintura', icon: '🎨', order: 90, equipment: ['eq-lixadeira-orbital', 'eq-compressor-ar', 'eq-pistola-hvlp', 'eq-kit-pintura', 'eq-escada-extensiva'] },
  { id: 'svc-pintura-grande', name: 'Pintura de fachadas e áreas amplas', description: 'Aplicação rápida e uniforme em fachadas, muros e grandes superfícies.', category: 'Pintura', icon: '🏠', order: 100, equipment: ['eq-pistola-airless', 'eq-lixadeira-orbital', 'eq-escada-extensiva', 'eq-andaime'] }
];


const initialAccountsPayable = [
  { id: 'ap-aluguel', description: 'Aluguel do ponto comercial', category: 'Despesa fixa', supplier: 'Imobiliária / proprietário', dueDate: monthDate(10), amount: 1200, status: 'pendente', notes: 'Despesa mensal operacional da loja.' },
  { id: 'ap-energia', description: 'Energia elétrica', category: 'Despesa fixa', supplier: 'Concessionária de energia', dueDate: monthDate(15), amount: 430, status: 'pendente', notes: 'Custo previsto para funcionamento da unidade.' },
  { id: 'ap-internet', description: 'Internet e telefone', category: 'Despesa fixa', supplier: 'Operadora de telecomunicações', dueDate: monthDate(18), amount: 180, status: 'pago', notes: 'Conta já considerada paga no mês.' },
  { id: 'ap-manutencao', description: 'Manutenção preventiva de equipamentos', category: 'Manutenção', supplier: 'Oficina parceira', dueDate: monthDate(22), amount: 350, status: 'pendente', notes: 'Revisão preventiva dos equipamentos de maior giro.' },
  { id: 'ap-pecas', description: 'Compra de peças e acessórios', category: 'Fornecedor', supplier: 'Fornecedor de peças', dueDate: monthDate(25), amount: 620, status: 'pendente', notes: 'Reposição de acessórios e itens de desgaste.' }
];

const initialRentalPackages = [
  { id: 'pkg-concretagem', serviceId: 'svc-concretagem', name: 'Pacote Concretagem Essencial', description: 'Betoneira, compactador e placa vibratória para preparar e finalizar a base.', discount: 7, items: [['eq-betoneira', 1], ['eq-compactador', 1], ['eq-placa', 1]] },
  { id: 'pkg-limpeza', serviceId: 'svc-limpeza-pos-obra', name: 'Pacote Limpeza Pós-Obra', description: 'Aspirador, lavadora e enceradeira para limpeza completa.', discount: 10, items: [['eq-aspirador-industrial', 1], ['eq-lavadora', 1], ['eq-enceradeira', 1]] },
  { id: 'pkg-jardim', serviceId: 'svc-corte-grama', name: 'Pacote Jardim Completo', description: 'Cortadora, roçadeira e soprador para cuidar de toda a área verde.', discount: 8, items: [['eq-cortadora-grama', 1], ['eq-rocadeira', 1], ['eq-soprador', 1]] },
  { id: 'pkg-pintura', serviceId: 'svc-pintura', name: 'Pacote Pintura Completa', description: 'Compressor, pistola HVLP, lixadeira orbital, escada e kit de pintura.', discount: 10, items: [['eq-compressor-ar', 1], ['eq-pistola-hvlp', 1], ['eq-lixadeira-orbital', 1], ['eq-escada-extensiva', 1], ['eq-kit-pintura', 1]] }
];

function seedDatabase() {
  const adminCount = Number(db.prepare('SELECT COUNT(*) AS total FROM administrators').get().total);
  if (adminCount === 0) {
    db.prepare('INSERT INTO administrators (name, email, password_hash) VALUES (?, ?, ?)')
      .run('Administrador', 'admin@casadosmateriais.com', hashPassword('123456'));
  }

  const insertEquipment = db.prepare(`
    INSERT INTO equipment (
      id, name, category, total, status, daily, deposit, power, weight, serial,
      next_review, accessories, image, description
    ) VALUES (
      @id, @name, @category, @total, @status, @daily, @deposit, @power, @weight, @serial,
      @nextReview, @accessories, @image, @description
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      category = excluded.category,
      total = excluded.total,
      status = excluded.status,
      daily = excluded.daily,
      deposit = excluded.deposit,
      power = excluded.power,
      weight = excluded.weight,
      serial = excluded.serial,
      next_review = excluded.next_review,
      accessories = excluded.accessories,
      image = excluded.image,
      description = excluded.description,
      updated_at = CURRENT_TIMESTAMP
  `);

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const item of initialEquipment) {
      insertEquipment.run({ ...item, accessories: JSON.stringify(item.accessories) });
    }

    const insertService = db.prepare(`
      INSERT INTO assistant_services (id, name, description, category, icon, active, sort_order)
      VALUES (@id, @name, @description, @category, @icon, 1, @order)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description,
        category=excluded.category, icon=excluded.icon, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP
    `);
    const insertRecommendation = db.prepare(`
      INSERT OR REPLACE INTO assistant_recommendations (service_id, equipment_id, priority)
      VALUES (?, ?, ?)
    `);
    for (const service of initialAssistantServices) {
      insertService.run({ id: service.id, name: service.name, description: service.description, category: service.category, icon: service.icon, order: service.order });
      service.equipment.forEach((equipmentId, index) => insertRecommendation.run(service.id, equipmentId, index + 1));
    }

    const insertPackage = db.prepare(`
      INSERT INTO rental_packages (id, service_id, name, description, discount_percent, active)
      VALUES (@id, @serviceId, @name, @description, @discount, 1)
      ON CONFLICT(id) DO UPDATE SET service_id=excluded.service_id, name=excluded.name,
        description=excluded.description, updated_at=CURRENT_TIMESTAMP
    `);
    const insertPackageItem = db.prepare(`
      INSERT OR REPLACE INTO rental_package_items (package_id, equipment_id, quantity)
      VALUES (?, ?, ?)
    `);
    for (const pack of initialRentalPackages) {
      insertPackage.run({ id: pack.id, serviceId: pack.serviceId, name: pack.name, description: pack.description, discount: pack.discount });
      pack.items.forEach(([equipmentId, quantity]) => insertPackageItem.run(pack.id, equipmentId, quantity));
    }

    const insertPayable = db.prepare(`
      INSERT INTO accounts_payable (id, description, category, supplier, due_date, amount, status, paid_at, notes)
      VALUES (@id, @description, @category, @supplier, @dueDate, @amount, @status, @paidAt, @notes)
      ON CONFLICT(id) DO UPDATE SET
        description=excluded.description,
        category=excluded.category,
        supplier=excluded.supplier,
        due_date=excluded.due_date,
        amount=excluded.amount,
        status=excluded.status,
        paid_at=excluded.paid_at,
        notes=excluded.notes,
        updated_at=CURRENT_TIMESTAMP
    `);
    for (const payable of initialAccountsPayable) {
      insertPayable.run({ ...payable, paidAt: payable.status === 'pago' ? monthDate(5) : null });
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

seedDatabase();

function seedEquipmentUnits() {
  const items = db.prepare('SELECT id, total, serial, status, next_review FROM equipment ORDER BY id').all();
  const countStmt = db.prepare('SELECT COUNT(*) AS total FROM equipment_units WHERE equipment_id = ?');
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO equipment_units
      (id, equipment_id, asset_code, serial_number, status, last_review, next_review, notes)
    VALUES (?, ?, ?, ?, ?, NULL, ?, '')
  `);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const item of items) {
      const existing = Number(countStmt.get(item.id).total || 0);
      for (let index = existing + 1; index <= Number(item.total); index += 1) {
        const suffix = String(index).padStart(3, '0');
        const assetCode = `${item.serial}-${suffix}`;
        const status = item.status === 'disponivel' ? 'disponivel' : item.status;
        insertStmt.run(`unit-${item.id}-${suffix}`, item.id, assetCode, assetCode, status, item.next_review);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

seedEquipmentUnits();

function safeJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseEquipment(row) {
  if (!row) return null;
  return {
    ...row,
    nextReview: row.next_review,
    accessories: safeJsonArray(row.accessories)
  };
}

module.exports = { db, databasePath, parseEquipment, safeJsonArray, initialEquipment, initialAssistantServices, initialRentalPackages, initialAccountsPayable, hashPassword, verifyPassword };
