import { ICredentialType, INodeProperties } from 'n8n-workflow';

export class YouTubeDLCookies implements ICredentialType {
  name = 'youTubeDLCookies';
  displayName = 'YouTube Cookies';
  documentationUrl = 'https://github.com/prakashmaheshwaran/n8n-nodes-youtube-dl#cookie-authentication';
  properties: INodeProperties[] = [
    {
      displayName: 'Cookies JSON',
      name: 'cookiesJson',
      type: 'string',
      typeOptions: {
        rows: 10,
      },
      default: '',
      placeholder:
        '[{"name":"LOGIN_INFO","value":"...","domain":".youtube.com","path":"/","secure":true}]',
      description:
        'YouTube cookies as a JSON array. Export from your browser using a cookie extension (e.g. EditThisCookie). Each cookie should have: name, value, domain, path, secure, httpOnly, expirationDate.',
    },
  ];
}
