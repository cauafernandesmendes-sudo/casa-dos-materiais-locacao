# Casa dos materiais — Sistema de locação de equipamentos

Sistema web desenvolvido para controle de locação e agendamento de equipamentos da empresa fictícia **Casa dos materiais**.

O projeto utiliza front-end em HTML, CSS e JavaScript, back-end em Node.js com Express e banco de dados SQLite local.

## Funcionalidades principais

- Catálogo de equipamentos por categoria.
- Cadastro e login de cliente pessoa física e pessoa jurídica.
- Agendamento de reservas com cálculo de diárias, frete, desconto CNPJ e garantia/caução vinculada.
- Formas de pagamento disponíveis: PIX, cartão de crédito, cartão de débito e boleto.
- Contrato digital e recibo de locação.
- Confirmação por WhatsApp com mensagem pronta para envio.
- Área do cliente com histórico de reservas e Programa ObraFácil.
- Painel administrativo com dashboard gerencial.
- Controle de reservas, calendário, clientes, equipamentos e patrimônio.
- Controle de manutenção preventiva.
- Controle de entregas e recolhimentos com mapa do endereço.
- Módulo financeiro com receita recebida, valores pendentes, ticket médio, contas a receber e contas a pagar.
- Metas administrativas.
- Exportação CSV em áreas administrativas.

## Tecnologias utilizadas

- HTML5
- CSS3
- JavaScript
- Node.js
- Express
- SQLite
- Sessões HTTP com `express-session`
- Hash de senha com `scrypt` da biblioteca nativa `crypto`

## Requisito

Instale o **Node.js 22.5 ou superior**.

Para conferir a instalação:

```bash
node --version
npm --version
```

## Como executar no Windows pelo VS Code

Abra a pasta **sistema-locacao-banco** no VS Code ou entre nela pelo terminal.

Instale as dependências:

```powershell
npm.cmd install
```

Inicie o servidor:

```powershell
npm.cmd start
```

Depois acesse:

```text
http://localhost:3000/index.html?v=46
```

Painel administrativo:

```text
http://localhost:3000/admin.html?v=46
```

## Login administrativo

```text
E-mail: admin@casadosmateriais.com
Senha: 123456
```

## Banco de dados

O sistema usa SQLite. O banco local fica em:

```text
database/casa-dos-materiais.db
```

A estrutura das tabelas está no arquivo:

```text
schema.sql
```

O arquivo que inicializa a conexão e os dados base é:

```text
database.js
```

## Estrutura principal

```text
sistema-locacao-banco/
├── database/
│   └── casa-dos-materiais.db
├── public/
│   ├── assets/
│   ├── index.html
│   ├── admin.html
│   ├── minha-conta.html
│   ├── contrato.html
│   ├── nota-fiscal.html
│   ├── styles.css
│   ├── app.js
│   ├── client-auth.js
│   ├── client.js
│   ├── admin.js
│   ├── account.js
│   ├── contract.js
│   └── invoice.js
├── database.js
├── reset-database.js
├── schema.sql
├── server.js
├── package.json
├── package-lock.json
└── README.md
```

## Como explicar o funcionamento

O sistema segue uma arquitetura cliente-servidor. As telas ficam na pasta `public`. Quando o usuário faz uma ação, como uma reserva, o JavaScript envia uma requisição para o servidor Node.js. O arquivo `server.js` valida os dados, aplica as regras de negócio e grava ou consulta as informações no SQLite. Depois, o servidor devolve a resposta para a interface.

Fluxo resumido:

```text
Tela do cliente → JavaScript → server.js → SQLite → resposta para a tela
```

## Resetar banco de teste

Para apagar os dados cadastrados e recriar o catálogo inicial:

```powershell
npm.cmd run reset-db
```

## Observações para entrega

- Não é necessário entregar a pasta `node_modules`.
- A pasta `node_modules` é recriada com `npm.cmd install`.
- Não apague o arquivo `database/casa-dos-materiais.db` se quiser manter dados cadastrados.
- Antes de copiar o projeto para pendrive ou ZIP, pare o servidor com `Ctrl + C`.
