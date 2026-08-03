-- =====================================================================
-- ORION AGRO — Migração 039
-- Ajusta "Pessoas e Empresas": tipo Física/Jurídica, papel Funcionário,
-- documentos adicionais (RG, Insc. Estadual/Municipal), contato e
-- endereço completo — inspirado num sistema de referência que o
-- usuário já usa pra esse cadastro. Também trava a exclusão de pessoa
-- referenciada em movimentações ou como proprietário de fazenda.
-- =====================================================================

alter type papel_pessoa add value 'FUNCIONARIO';

create type tipo_natureza_pessoa as enum ('FISICA', 'JURIDICA');

alter table pessoas
  add column tipo_pessoa         tipo_natureza_pessoa not null default 'FISICA',
  add column rg                  text,
  add column inscricao_estadual  text,
  add column inscricao_municipal text,
  add column nome_contato        text,
  add column nacionalidade       text default 'Brasil',
  add column cep                 text,
  add column endereco            text,
  add column numero              text,
  add column bairro              text,
  add column cidade              text,
  add column estado              text,
  add column pais                text default 'Brasil',
  add column telefone            text,
  add column celular             text,
  add column email               text,
  add column observacoes         text;

-- Exclusão de pessoa: só permitida se não estiver referenciada em
-- nenhuma movimentação (cliente/fornecedor) nem como proprietário de
-- fazenda. Passando essa checagem, apaga os pessoa_papeis dela junto
-- (mesmo princípio de cascata via trigger já usado em fn_validar_delete_fazenda).
create or replace function fn_validar_delete_pessoa()
returns trigger as $$
begin
  if exists (select 1 from movimentacoes_rebanho where cliente_fornecedor_id = old.id) then
    raise exception 'Não é possível excluir: essa pessoa já está referenciada em movimentações. Inative-a em vez disso.';
  end if;

  if exists (select 1 from fazendas where proprietario_id = old.id) then
    raise exception 'Não é possível excluir: essa pessoa é proprietária de uma fazenda. Inative-a em vez disso.';
  end if;

  delete from pessoa_papeis where pessoa_id = old.id;

  return old;
end;
$$ language plpgsql;

create trigger trg_validar_delete_pessoa
before delete on pessoas
for each row execute function fn_validar_delete_pessoa();

-- =====================================================================
-- FIM DA MIGRAÇÃO 039
-- =====================================================================
