import { administracaoApi } from './administracao.api';
import { autenticacaoApi } from './autenticacao.api';
import { cadastroApi } from './cadastro.api';
import { documentosApi } from './documentos.api';
import { dofApi } from './dof.api';
import { dtcApi } from './dtc.api';
import { sincronizacaoApi } from './sincronizacao.api';

export { ErroApi, requisitar, validar } from './http';

/** Compõe clientes tipados sem criar estado ou outra camada de transporte. */
export const api = {
  ...autenticacaoApi,
  ...administracaoApi,
  ...sincronizacaoApi,
  ...cadastroApi,
  ...documentosApi,
  ...dtcApi,
  ...dofApi,
};
