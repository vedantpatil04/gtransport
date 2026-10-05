import { base64UrlToBytes, htmlToText, parseAddressList } from './mail-text';

describe('parseAddressList', () => {
  it('reads names and addresses, with commas inside quotes left alone', () => {
    expect(parseAddressList('"Kumar, Ramesh" <Ramesh@Example.in>, ops@gangamata.example')).toEqual([
      { name: 'Kumar, Ramesh', address: 'ramesh@example.in' },
      { name: null, address: 'ops@gangamata.example' },
    ]);
  });

  it('drops an entry that is not an address rather than storing it as one', () => {
    expect(parseAddressList('undisclosed-recipients:;')).toEqual([]);
    expect(parseAddressList(undefined)).toEqual([]);
  });
});

describe('htmlToText', () => {
  it('keeps the words and drops the markup, scripts and styles', () => {
    const text = htmlToText('<style>p{color:red}</style><p>Invoice &amp; job card</p><script>alert(1)</script><div>Total ₹4,850</div>');
    expect(text).toBe('Invoice & job card\nTotal ₹4,850');
    expect(text).not.toContain('alert');
  });
});

describe('base64UrlToBytes', () => {
  it('decodes Gmail’s URL-safe base64', () => {
    const encoded = Buffer.from('hello?>').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    expect(Buffer.from(base64UrlToBytes(encoded)).toString()).toBe('hello?>');
  });
});
