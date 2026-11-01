/** Identifica o pool único registrado por InfraestruturaModule, sem depender de uma classe concreta. */
export const BANCO = Symbol('BANCO');
/** Identifica configuração validada e externa ao Git; nunca deve ser serializada em logs. */
export const CONFIGURACAO = Symbol('CONFIGURACAO');
