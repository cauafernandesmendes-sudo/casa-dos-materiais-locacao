# Casa dos Materiais — Sistema Web de Locação e Agendamento

Projeto de TCC do curso de Análise e Desenvolvimento de Sistemas.

O sistema simula uma locadora de equipamentos para construção, limpeza, jardinagem e pintura. Ele possui catálogo público, cadastro de clientes, reserva com orçamento, contrato, recibo e painel administrativo com reservas, financeiro, patrimônio, manutenção, entregas, metas e Programa ObraFácil.

## Tecnologias

- HTML5, CSS3 e JavaScript
- Node.js
- Express
- SQLite
- express-session
- crypto/scrypt para proteção de senhas

## Requisitos

- Node.js 22.5 ou superior
- npm

Para conferir:

```bash
node --version
npm --version
```

## Como executar

Abra esta pasta no VS Code ou no terminal e execute:

```powershell
npm.cmd install
npm.cmd start
```

Se estiver usando Prompt de Comando em vez de PowerShell, também pode usar:

```cmd
npm install
npm start
```

Depois acesse no navegador:

```text
http://localhost:3000
```

Painel administrativo:

```text
http://localhost:3000/admin.html
```

## Acesso administrativo de demonstração

```text
E-mail: admin@casadosmateriais.com
Senha: 123456
```

## Banco de dados

O sistema usa SQLite local. O arquivo do banco fica em:

```text
database/casa-dos-materiais.db
```

A estrutura das tabelas está em:

```text
schema.sql
```

Para recriar o banco com os dados iniciais:

```powershell
npm.cmd run reset-db
```

## Estrutura principal

```text
casa-dos-materiais-tcc/
├── database/
├── public/
│   ├── assets/
│   ├── index.html
│   ├── admin.html
│   ├── minha-conta.html
│   ├── contrato.html
│   ├── nota-fiscal.html
│   ├── styles.css
│   └── scripts JavaScript
├── database.js
├── reset-database.js
├── schema.sql
├── server.js
├── package.json
├── package-lock.json
├── iniciar.bat
└── README.md
```

## Observação para avaliação

A pasta `node_modules` não acompanha o projeto porque deve ser recriada com `npm install`. As imagens do catálogo foram mantidas localmente para que o sistema funcione sem depender de links externos.
