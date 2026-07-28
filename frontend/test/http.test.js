import { describe, expect, it } from 'vitest'
import { asList, errorMessage, paginationOf, unwrap } from '../src/services/http.js'

describe('contratos HTTP do frontend', () => {
  it('desembrulha o envelope padrão da API', () => {
    expect(unwrap({ data: { data: { id: '1' } } })).toEqual({ id: '1' })
  })

  it('normaliza listas e paginação', () => {
    const payload = { items: [{ id: '1' }], page: 2, limit: 25, total: 60 }
    expect(asList(payload)).toEqual([{ id: '1' }])
    expect(paginationOf(payload)).toEqual({ page: 2, rowsPerPage: 25, rowsNumber: 60 })
  })

  it('prioriza a mensagem estruturada da API', () => {
    expect(errorMessage({ response: { data: { message: 'Falha validada' } } })).toBe('Falha validada')
  })

  it('inclui os motivos de validação do envelope padronizado', () => {
    const error = {
      response: {
        data: {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Dados invalidos',
            details: {
              formErrors: ['Revise o formulário'],
              fieldErrors: {
                body: ['Informe o numero publico do WhatsApp com DDI (8 a 15 digitos)'],
              },
            },
          },
        },
      },
    }

    expect(errorMessage(error)).toBe(
      'Dados invalidos: Revise o formulário Informe o numero publico do WhatsApp com DDI (8 a 15 digitos)',
    )
  })
})
