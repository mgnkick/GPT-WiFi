/** Open the current DHCP gateway, or a user-saved gateway if the current one is unknown. */
export const openRouterWebDirect = (defaultGateway?: string) => {
  const validIp = (value?: string | null) => Boolean(value && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value));
  const storedIp = localStorage.getItem('wifi-expert-gateway-ip');
  const ip = validIp(defaultGateway) ? defaultGateway! : (validIp(storedIp) ? storedIp! : '');
  if (!ip) return;
  const targetUrl = `http://${ip}`;

  try {
    const newWindow = window.open(targetUrl, '_blank', 'noopener,noreferrer');
    if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
      const link = document.createElement('a');
      link.href = targetUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  } catch {
    window.location.href = targetUrl;
  }
};
