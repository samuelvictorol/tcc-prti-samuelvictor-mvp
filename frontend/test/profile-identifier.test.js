import { describe, expect, it } from 'vitest'
import {
  formatBrazilianProfilePhone,
  normalizeProfileIdentifierForRequest,
  profileIdentifierRule,
  updateBrazilianProfilePhoneInput,
  updateProfileIdentifierInput,
} from '../src/services/profile-identifier.js'

describe('identificador do login de perfil', () => {
  it('formata telefones brasileiros de dez e onze dígitos', () => {
    expect(formatBrazilianProfilePhone('6181748795')).toBe('(61) 8174-8795')
    expect(formatBrazilianProfilePhone('61981748795')).toBe('(61) 9 8174-8795')
  })

  it('mantém a formatação durante a digitação e envia o país para a API', () => {
    const input = updateProfileIdentifierInput('61981748795')

    expect(input).toEqual({ mode: 'phone', value: '(61) 9 8174-8795' })
    expect(profileIdentifierRule(input.value, input.mode)).toBe(true)
    expect(normalizeProfileIdentifierForRequest(input.value, input.mode)).toBe('5561981748795')
  })

  it('aplica a máscara nacional sem aceitar mais de onze dígitos', () => {
    expect(updateBrazilianProfilePhoneInput('6181748795')).toBe('(61) 8174-8795')
    expect(updateBrazilianProfilePhoneInput('61981748795')).toBe('(61) 9 8174-8795')
    expect(updateBrazilianProfilePhoneInput('61981748795123')).toBe('(61) 9 8174-8795')
  })

  it('troca para email ao ultrapassar o telefone sem perder nenhum dígito', () => {
    const input = updateProfileIdentifierInput(
      '(61) 9 8174-87952',
      'phone',
      '(61) 9 8174-8795',
    )

    expect(input).toEqual({ mode: 'email', value: '619817487952' })
    expect(profileIdentifierRule(input.value, input.mode)).toBe('Digite um email válido')
  })

  it('remove apenas a apresentação do telefone quando o usuário passa a digitar email', () => {
    const input = updateProfileIdentifierInput('(12)3@exemplo.com', 'phone', '(12)3')

    expect(input).toEqual({ mode: 'email', value: '123@exemplo.com' })
    expect(normalizeProfileIdentifierForRequest(input.value, input.mode)).toBe('123@exemplo.com')
  })

  it('preserva pontuação de um email iniciado por números', () => {
    const input = updateProfileIdentifierInput('(12)3+tag', 'phone', '(12)3')

    expect(input).toEqual({ mode: 'email', value: '123+tag' })
  })

  it('preserva emails colados, inclusive caracteres internacionais', () => {
    const email = 'usuário+perfil@exemplo.com.br'
    const input = updateProfileIdentifierInput(email)

    expect(input).toEqual({ mode: 'email', value: email })
    expect(profileIdentifierRule(input.value, input.mode)).toBe(true)
    expect(normalizeProfileIdentifierForRequest(input.value, input.mode)).toBe(email)
  })

  it('volta automaticamente ao telefone se a entrada tornar-se compatível novamente', () => {
    const input = updateProfileIdentifierInput('61981748795', 'email')

    expect(input).toEqual({ mode: 'phone', value: '(61) 9 8174-8795' })
  })
})
