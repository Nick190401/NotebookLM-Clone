import { privateAddress } from '../../../supabase/functions/source-import/handler.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const BLOCKED = [
  '0.0.0.0',
  '127.0.0.1',
  '10.0.0.1',
  '172.16.0.1',
  '172.31.255.255',
  '192.168.1.1',
  '169.254.169.254',
  '100.64.0.1',
  '224.0.0.1',
  '255.255.255.255',
  '192.0.0.1',
  '192.0.2.1',
  '198.18.0.1',
  '198.51.100.1',
  '203.0.113.1',
  '::1',
  '[::1]',
  '::',
  'fd00::1',
  'fe80::1',
  '2001:db8::1',
  '::ffff:127.0.0.1',
]

const ALLOWED = [
  '8.8.8.8',
  '1.1.1.1',
  '93.184.216.34',
  '172.15.0.1',
  '172.32.0.1',
  '192.0.5.1',
  '192.1.0.1',
  '2606:4700:4700::1111',
  '2001:4860:4860::8888',
]

Deno.test('the address filter blocks every reserved and private destination', () => {
  for (const address of BLOCKED) {
    assert(privateAddress(address), `${address} was treated as a public destination`)
  }
})

Deno.test('the address filter allows ordinary public destinations', () => {
  for (const address of ALLOWED) {
    assert(!privateAddress(address), `${address} was refused as private`)
  }
})

Deno.test('numeric host forms are normalised before the address filter sees them', () => {
  // The guard never parses these itself; WHATWG URL turns them into 127.0.0.1 first.
  for (const url of ['http://2130706433/', 'http://0177.0.0.1/', 'http://0x7f.1/', 'http://127.1/']) {
    const { hostname } = new URL(url)
    assert(privateAddress(hostname), `${url} resolved to ${hostname}, which the filter allowed`)
  }
})
