'use strict';

const { asString, normalizeHardwareIds } = require('./verdict');

/**
 * Every URL in this file is an official manufacturer page. The allowlist used by
 * the main process is derived from these tables, so a link can never be opened
 * unless it points at one of them (plus the Microsoft catalog / settings URIs).
 */

/* ── component vendors (PCI/USB vendor ids, 4 hex lowercase) ─────────── */

const VENDORS = {
  // graphics
  '10de': { name: 'NVIDIA', url: 'https://www.nvidia.com/Download/index.aspx' },
  '1002': { name: 'AMD', url: 'https://www.amd.com/es/support' },
  '1022': { name: 'AMD', url: 'https://www.amd.com/es/support' },
  '5143': { name: 'Qualcomm Adreno', url: 'https://www.qualcomm.com/support' },
  '13b5': { name: 'ARM', url: 'https://developer.arm.com/downloads' },
  '1af4': { name: 'Red Hat (virtio)', url: 'https://www.linux-kvm.org/page/WindowsGuestDrivers/Download_Drivers' },
  '1ae0': { name: 'Google', url: 'https://support.google.com/chrome' },
  '1414': { name: 'Microsoft (Hyper-V)', url: 'https://support.microsoft.com/windows' },
  '15ad': { name: 'VMware', url: 'https://support.broadcom.com/group/ecx/downloads' },
  '80ee': { name: 'Oracle VirtualBox', url: 'https://www.virtualbox.org/wiki/Downloads' },
  '1234': { name: 'QEMU', url: 'https://www.qemu.org/download/' },

  // Intel (graphics, network, bluetooth, chipset, storage, thunderbolt)
  '8086': {
    name: 'Intel',
    url: 'https://www.intel.com/content/www/us/en/download-center/home.html',
    routes: {
      network: 'https://www.intel.com/content/www/us/en/download/19351/intel-wireless-wi-fi-drivers-for-windows-10-and-windows-11.html',
      bluetooth: 'https://www.intel.com/content/www/us/en/download/18649/intel-wireless-bluetooth-for-windows-10-and-windows-11.html',
    },
  },
  '8087': { name: 'Intel', url: 'https://www.intel.com/content/www/us/en/download-center/home.html' },
  '1a56': { name: 'Intel (Killer)', url: 'https://www.intel.com/content/www/us/en/download-center/home.html' },
  '0b40': { name: 'Intel (Killer)', url: 'https://www.intel.com/content/www/us/en/download-center/home.html' },

  // Realtek (audio, network, card readers, NVMe)
  '10ec': {
    name: 'Realtek',
    url: 'https://www.realtek.com/en/downloads',
    routes: {
      audio: 'https://www.realtek.com/Download/List?cate_id=593',
      network: 'https://www.realtek.com/Download/List?cate_id=584',
    },
  },
  '0bda': { name: 'Realtek', url: 'https://www.realtek.com/en/downloads' },
  '0bcf': { name: 'Realtek', url: 'https://www.realtek.com/en/downloads' },

  // wireless / networking
  '14e4': { name: 'Broadcom', url: 'https://www.broadcom.com/support/download-search' },
  '0a5c': { name: 'Broadcom', url: 'https://www.broadcom.com/support/download-search' },
  '168c': { name: 'Qualcomm Atheros', url: 'https://www.qualcomm.com/support' },
  '17cb': { name: 'Qualcomm', url: 'https://www.qualcomm.com/support' },
  '14c3': { name: 'MediaTek', url: 'https://www.mediatek.com/products/broadband-wifi' },
  '0e8d': { name: 'MediaTek', url: 'https://www.mediatek.com/products/broadband-wifi' },
  '11ab': { name: 'Marvell', url: 'https://www.marvell.com/support.html' },
  '1b4b': { name: 'Marvell', url: 'https://www.marvell.com/support.html' },
  '1b21': { name: 'ASMedia', url: 'https://www.asmedia.com.tw/support' },
  '1a2b': { name: 'ASMedia', url: 'https://www.asmedia.com.tw/support' },
  '10dd': { name: 'NVIDIA (nForce)', url: 'https://www.nvidia.com/Download/index.aspx' },
  '1283': { name: 'ITE', url: 'https://www.ite.com.tw' },
  '10b7': { name: '3Com', url: 'https://support.hpe.com/' },
  '1186': { name: 'D-Link', url: 'https://support.dlink.com/' },
  '1259': { name: 'Allied Telesis', url: 'https://www.alliedtelesis.com/support' },
  '1106': { name: 'VIA', url: 'https://www.viatech.com/en/support/' },
  '1039': { name: 'SiS', url: 'https://www.sis.com' },
  '10b9': { name: 'ALi', url: 'https://www.ali.com.tw' },
  '104c': { name: 'Texas Instruments', url: 'https://www.ti.com/support-lines' },
  '1043': { name: 'ASUS', url: 'https://www.asus.com/es/support/download-center/' },

  // audio
  '13f6': { name: 'C-Media', url: 'https://www.cmedia.com.tw/support/download-center' },
  '1102': { name: 'Creative', url: 'https://support.creative.com/' },
  '1235': { name: 'Focusrite', url: 'https://support.focusrite.com/' },
  '0763': { name: 'M-Audio', url: 'https://www.m-audio.com/support' },
  '17cc': { name: 'Native Instruments', url: 'https://support.native-instruments.com/' },
  '0582': { name: 'Roland', url: 'https://www.roland.com/global/support/' },
  '14f1': { name: 'Conexant', url: 'https://www.synaptics.com/products/audio' },
  '1b3b': { name: 'Waves', url: 'https://www.waves.com/support' },
  '1fc9': { name: 'NXP', url: 'https://www.nxp.com/support' },

  // storage
  '144d': { name: 'Samsung', url: 'https://semiconductor.samsung.com/consumer-storage/support/tools/' },
  '04e8': { name: 'Samsung', url: 'https://www.samsung.com/support/' },
  '1c5c': { name: 'SK hynix', url: 'https://ssd.skhynix.com/download/' },
  '1e0f': { name: 'Kioxia', url: 'https://www.kioxia.com/en-jp/support.html' },
  '15b7': { name: 'SanDisk / WD', url: 'https://support-en.wd.com/app/products/downloads' },
  '1b96': { name: 'Western Digital', url: 'https://support-en.wd.com/app/products/downloads' },
  '2646': { name: 'Kingston', url: 'https://www.kingston.com/en/support/technical' },
  '1987': { name: 'Phison', url: 'https://www.phison.com' },
  '1344': { name: 'Micron / Crucial', url: 'https://www.crucial.com/support' },
  '1b44': { name: 'ADATA', url: 'https://www.adata.com/en/support' },
  '1cc1': { name: 'ADATA', url: 'https://www.adata.com/en/support' },
  '1dbe': { name: 'Lite-On', url: 'https://www.liteon.com/en/support' },
  '1d97': { name: 'Plextor', url: 'https://www.plextor.com/support/' },
  '126f': { name: 'Silicon Motion', url: 'https://www.siliconmotion.com' },
  '1370': { name: 'Silicon Motion', url: 'https://www.siliconmotion.com' },

  // input / touchpad / fingerprint
  '06cb': { name: 'Synaptics', url: 'https://www.synaptics.com/products/touchpad-family' },
  '04f3': { name: 'ELAN', url: 'https://www.emc.com.tw/emc/en/Download' },
  '0488': { name: 'ALPS ALPINE', url: 'https://www.alpsalpine.com/e/products/' },
  '044e': { name: 'ALPS ALPINE', url: 'https://www.alpsalpine.com/e/products/' },
  '27c6': { name: 'Goodix', url: 'https://www.goodix.com/en/support/download' },
  '1c7a': { name: 'EgisTec', url: 'https://www.egistec.com' },
  '08ff': { name: 'AuthenTec', url: 'https://www.synaptics.com/products/biometrics' },
  '138a': { name: 'Validity Sensors', url: 'https://www.synaptics.com/products/biometrics' },
  '147e': { name: 'UPEK', url: 'https://www.synaptics.com/products/biometrics' },
  '056a': { name: 'Wacom', url: 'https://www.wacom.com/en-us/support/product-support' },
  '056d': { name: 'EIZO', url: 'https://www.eizoglobal.com/support/' },
  '04d9': { name: 'Holtek', url: 'https://www.holtek.com' },
  '046d': { name: 'Logitech', url: 'https://support.logi.com/' },
  '1532': { name: 'Razer', url: 'https://mysupport.razer.com/' },
  '1b1c': { name: 'Corsair', url: 'https://www.corsair.com/us/en/s/downloads' },
  '1038': { name: 'SteelSeries', url: 'https://steelseries.com/gg' },
  '0951': { name: 'HyperX', url: 'https://hyperx.com/pages/downloads' },
  '2516': { name: 'Cooler Master', url: 'https://www.coolermaster.com/en-global/downloads/' },
  '1e71': { name: 'NZXT', url: 'https://nzxt.com/pages/downloads' },
  '1462': { name: 'MSI', url: 'https://www.msi.com/support/download' },
  '0b05': { name: 'ASUS', url: 'https://www.asus.com/es/support/download-center/' },
  '1458': { name: 'Gigabyte', url: 'https://www.gigabyte.com/Support' },
  '051d': { name: 'American Power Conversion', url: 'https://www.apc.com/support' },
  '0463': { name: 'Eaton', url: 'https://www.eaton.com/support' },
  '10c4': { name: 'Silicon Labs', url: 'https://www.silabs.com/support' },
  '1a86': { name: 'WCH', url: 'https://www.wch-ic.com' },

  // cameras / capture / other
  '1137': { name: 'Cisco', url: 'https://www.cisco.com/c/en/us/support/index.html' },
  '0c45': { name: 'Sonix', url: 'https://www.sonix.com.tw' },
  '1bcf': { name: 'Sunplus', url: 'https://www.sunplusit.com' },
  '05ca': { name: 'Ricoh', url: 'https://www.ricoh.com' },
  '04a9': { name: 'Canon', url: 'https://www.canon.com/support' },
  '04b8': { name: 'Epson', url: 'https://epson.com/support' },
  '03f0': { name: 'HP', url: 'https://support.hp.com/es-es/drivers' },
  '067b': { name: 'Prolific', url: 'https://www.prolific.com.tw' },
  '0403': { name: 'FTDI', url: 'https://ftdichip.com/drivers/' },

  // OEM / system vendor ids that appear as devices
  '1028': { name: 'Dell', url: 'https://www.dell.com/support/home/es-es?app=drivers' },
  '103c': { name: 'HP', url: 'https://support.hp.com/es-es/drivers' },
  '17aa': { name: 'Lenovo', url: 'https://pcsupport.lenovo.com/' },
  '1025': { name: 'Acer', url: 'https://www.acer.com/es-es/support' },
  '1179': { name: 'Dynabook / Toshiba', url: 'https://support.dynabook.com/' },
  '045e': { name: 'Microsoft', url: 'https://support.microsoft.com/windows' },
  '05ac': { name: 'Apple', url: 'https://support.apple.com/es-es/windows' },
};

/* ── device class → routing group ───────────────────────────────────────── */

const CLASS_GROUPS = {
  DISPLAY: 'graphics',
  NET: 'network',
  MEDIA: 'audio',
  AUDIO: 'audio',
  AUDIOENDPOINT: 'audio',
  BLUETOOTH: 'bluetooth',
  HDC: 'storage',
  SCSIADAPTER: 'storage',
  STORAGE: 'storage',
  DISKDRIVE: 'storage',
  VOLUME: 'storage',
  CDROM: 'storage',
  USB: 'usb',
  USBHUB: 'usb',
  HIDCLASS: 'input',
  MOUSE: 'input',
  KEYBOARD: 'input',
  MOUSE_CLASS: 'input',
  SYSTEM: 'chipset',
  PROCESSOR: 'chipset',
  FIRMWARE: 'firmware',
  BATTERY: 'power',
  BATTERYCLASS: 'power',
  CAMERA: 'camera',
  IMAGE: 'camera',
  MONITOR: 'display-output',
  PRINTER: 'printer',
  PRINTQUEUE: 'printer',
  SECURITYDEVICES: 'security',
  SMARTCARDREADER: 'security',
  PORTS: 'ports',
  MODEM: 'network',
  WCEUSBSH: 'usb',
  LIGHTS: 'input',
};

/** Classes where the OEM of the machine owns the correct package. */
const OEM_OWNED_GROUPS = new Set(['chipset', 'audio', 'input', 'storage', 'camera', 'power', 'firmware', 'security', 'ports', 'printer', 'display-output', 'usb']);

/* ── OEM / gaming brand pages ───────────────────────────────────────────── */

const OEM_PAGES = [
  {
    match: /lenovo|thinkpad|thinkcentre|ideapad|legion/i,
    name: 'Lenovo',
    url: 'https://pcsupport.lenovo.com/es/es/',
    note: 'Legion e IdeaPad Gaming: usa el número de serie para cargar los drivers exactos del modelo.',
    gaming: /legion/i,
  },
  {
    match: /dell|alienware/i,
    name: 'Dell / Alienware',
    url: 'https://www.dell.com/support/home/es-es',
    serialUrl: (serial) => `https://www.dell.com/support/home/es-es/product-support/servicetag/${encodeURIComponent(serial)}/drivers`,
    note: 'Dell abre directamente la ficha del equipo con el número de servicio.',
    gaming: /alienware|g3|g5|g7|g15|g16/i,
  },
  {
    match: /\bhp\b|hewlett|compaq|omen|victus/i,
    name: 'HP',
    url: 'https://support.hp.com/es-es/drivers',
    note: 'OMEN y Victus: usa «Detectar mi producto» o el número de serie.',
    gaming: /omen|victus|pavilion gaming/i,
  },
  {
    match: /asus|asustek|\brog\b|tuf|strix/i,
    name: 'ASUS / ROG',
    url: 'https://www.asus.com/es/support/download-center/',
    note: 'ROG, TUF y Strix: busca el modelo exacto en el centro de descargas; Armoury Crate gestiona el hardware ROG.',
    gaming: /rog|tuf|strix|zephyrus|scar/i,
  },
  {
    match: /acer|predator|nitro/i,
    name: 'Acer / Predator',
    url: 'https://www.acer.com/es-es/support',
    note: 'Predator y Nitro: drivers por modelo en el soporte de Acer.',
    gaming: /predator|nitro/i,
  },
  {
    match: /micro-star|\bmsi\b|katana|raider|stealth/i,
    name: 'MSI',
    url: 'https://www.msi.com/support/download',
    note: 'MSI Center e Dragon Center se descargan desde la ficha del modelo.',
    gaming: /katana|raider|stealth|vector|titan|gp6|ge6|gs6/i,
  },
  {
    match: /razer|blade/i,
    name: 'Razer',
    url: 'https://mysupport.razer.com/',
    note: 'Razer Blade: drivers por modelo y Synapse para periféricos.',
    gaming: /blade/i,
  },
  {
    match: /gigabyte|aorus/i,
    name: 'Gigabyte / AORUS',
    url: 'https://www.gigabyte.com/Support',
    note: 'AORUS: Control Center y drivers en la ficha del modelo.',
    gaming: /aorus/i,
  },
  { match: /samsung|odyssey/i, name: 'Samsung', url: 'https://www.samsung.com/support/', note: 'Galaxy Book y Odyssey: usa Samsung Update.', gaming: /odyssey/i },
  { match: /toshiba|dynabook/i, name: 'Dynabook', url: 'https://support.dynabook.com/', note: '' },
  { match: /sony|vaio/i, name: 'VAIO', url: 'https://us.vaio.com/support', note: '' },
  { match: /microsoft corporation/i, name: 'Microsoft Surface', url: 'https://support.microsoft.com/surface', note: 'Surface: usa Microsoft Update; los paquetes por modelo están en el soporte Surface.', gaming: false },
  { match: /huawei|honor|matebook/i, name: 'Huawei / Honor', url: 'https://consumer.huawei.com/en/support/', note: 'PC Manager instala los drivers del modelo.' },
  { match: /xiaomi|redmi/i, name: 'Xiaomi', url: 'https://www.mi.com/global/support/', note: '' },
  { match: /framework/i, name: 'Framework', url: 'https://knowledgebase.frame.work/', note: 'Framework publica un paquete de drivers por generación.' },
  { match: /system76/i, name: 'System76', url: 'https://support.system76.com/', note: '' },
  { match: /xmg|schenker|tuxedo|bestware/i, name: 'XMG / Schenker', url: 'https://www.xmg.gg/en/downloads-drivers/', note: '' },
  { match: /clevo|tongfang|eluktronics|hasee/i, name: 'Clevo / Tongfang (barebone)', url: 'https://www.clevo.com.tw/clevo_prodetail.asp?id=1266&lang=en', note: 'Barebones: los drivers suelen publicarse en la web del ensamblador (XMG, Eluktronics, Hasee).' },
  { match: /medion/i, name: 'Medion', url: 'https://www.medion.com/es/service/', note: '' },
  { match: /fujitsu/i, name: 'Fujitsu', url: 'https://support.ts.fujitsu.com/', note: '' },
  { match: /panasonic/i, name: 'Panasonic', url: 'https://na.panasonic.com/us/support', note: '' },
  { match: /lg electronics|lg gram/i, name: 'LG', url: 'https://www.lg.com/es/soporte', note: '' },
  { match: /gigabyte/i, name: 'Gigabyte', url: 'https://www.gigabyte.com/Support', note: '' },
  { match: /asrock/i, name: 'ASRock', url: 'https://www.asrock.com/support/index.asp', note: '' },
  { match: /biostar/i, name: 'Biostar', url: 'https://www.biostar.com.tw/app/en/support/index.php', note: '' },
  { match: /evga/i, name: 'EVGA', url: 'https://www.evga.com/support/', note: '' },
  { match: /nzxt/i, name: 'NZXT', url: 'https://nzxt.com/pages/downloads', note: '' },
  { match: /corsair/i, name: 'Corsair', url: 'https://www.corsair.com/us/en/s/downloads', note: '' },
  { match: /chuwi|teclast|jumper|beelink|minisforum|geekom/i, name: 'Mini PC / ultraportátil', url: 'https://www.microsoft.com/en-us/software-download/windows11', note: 'Estos fabricantes suelen publicar los drivers solo en su web o por correo; empieza por el fabricante del chip (Intel/AMD/Realtek).' },
];

/* ── Microsoft sources ─────────────────────────────────────────────────── */

const MS_CATALOG = 'https://www.catalog.update.microsoft.com/Search.aspx?q=';
const MS_CATALOG_HOME = 'https://www.catalog.update.microsoft.com/Home.aspx';
const MS_WINDOWS_UPDATE = 'ms-settings:windowsupdate';

/* ── helpers ───────────────────────────────────────────────────────────── */

const HOST_ALLOWLIST = new Set(['catalog.update.microsoft.com', 'www.catalog.update.microsoft.com']);

function hostOf(url) {
  try {
    return new URL(String(url)).hostname;
  } catch {
    return null;
  }
}

for (const vendor of Object.values(VENDORS)) {
  for (const link of [vendor.url, ...Object.values(vendor.routes || {})]) {
    const host = hostOf(link);
    if (host) HOST_ALLOWLIST.add(host);
  }
}
for (const oem of OEM_PAGES) {
  const host = hostOf(oem.url);
  if (host) HOST_ALLOWLIST.add(host);
}

function groupFor(classKey) {
  const key = asString(classKey).toUpperCase().replace(/\s+/g, '_');
  return CLASS_GROUPS[key] || 'generic';
}

function vendorIdFrom(driver) {
  const ids = normalizeHardwareIds(driver.hardwareIds);
  for (const id of ids) {
    const ven = id.match(/ven_?([0-9a-f]{4})/);
    if (ven) return { id: ven[1], kind: 'ven' };
    const vid = id.match(/vid_?([0-9a-f]{4})/);
    if (vid) return { id: vid[1], kind: 'vid' };
  }
  return null;
}

function chipFor(driver) {
  const found = vendorIdFrom(driver);
  if (!found) return null;
  const vendor = VENDORS[found.id];
  if (!vendor) return { id: found.id, name: `Fabricante ${found.id.toUpperCase()}`, url: null, group: groupFor(driver.classKey) };
  const group = groupFor(driver.classKey);
  return {
    id: found.id,
    name: vendor.name,
    group,
    url: (vendor.routes && vendor.routes[group]) || vendor.url,
    defaultUrl: vendor.url,
  };
}

function oemFor(system = {}) {
  const haystack = `${asString(system.manufacturer)} ${asString(system.model)} ${asString(system.productVersion)} ${asString(system.boardVendor)}`;
  const found = OEM_PAGES.find((entry) => entry.name && entry.match.test(haystack));
  if (!found) return null;
  const serial = asString(system.serial);
  const serialUrl = typeof found.serialUrl === 'function' && serial ? found.serialUrl(serial) : null;
  return {
    name: found.name,
    url: found.url,
    driversUrl: serialUrl || found.url,
    serialUrl,
    note: found.note || '',
    gaming: Boolean(found.gaming && found.gaming.test(haystack)),
  };
}

/**
 * Builds the Microsoft Update Catalog query for a device. Uses the shortest
 * (generic) hardware ID, rewritten as the canonical `bus\ven_x&dev_y` form.
 */
function catalogQueryFor(driver) {
  const ids = normalizeHardwareIds(driver.hardwareIds);
  if (ids.length === 0) return null;
  const shortest = [...ids].sort((a, b) => a.length - b.length)[0];
  const bus = shortest.split('\\')[0] || 'pci';
  const ven = shortest.match(/ven_?([0-9a-f]{4})/);
  const dev = shortest.match(/dev_?([0-9a-f]{4})/);
  if (ven && dev) return `${bus.toUpperCase()}\\VEN_${ven[1].toUpperCase()}&DEV_${dev[1].toUpperCase()}`;
  const vid = shortest.match(/vid_?([0-9a-f]{4})/);
  const pid = shortest.match(/pid_?([0-9a-f]{4})/);
  if (vid && pid) return `${bus.toUpperCase()}\\VID_${vid[1].toUpperCase()}&PID_${pid[1].toUpperCase()}`;
  return shortest.toUpperCase();
}

/**
 * Resolves every official route for one driver. Order follows the agreed rule:
 * the OEM owns system-class packages (chipset, audio, touchpad, storage…), the
 * silicon vendor owns graphics, networking and Bluetooth.
 */
function resolveLinks(driver, system = {}) {
  const chip = chipFor(driver);
  const oem = oemFor(system);
  const query = catalogQueryFor(driver);
  const group = chip ? chip.group : groupFor(driver.classKey);
  const oemFirst = OEM_OWNED_GROUPS.has(group);
  const serial = asString(system.serial);

  const routes = [];
  if (chip && chip.url) {
    routes.push({
      id: 'chip',
      label: chip.name,
      url: chip.url,
      note: `fabricante del componente · ${group}`,
      primary: !oemFirst,
    });
  }
  if (oem) {
    routes.push({
      id: 'oem',
      label: oem.name,
      url: oem.driversUrl,
      note: oem.serialUrl ? 'ficha del equipo por número de serie' : oem.gaming ? 'soporte del portátil gaming' : 'soporte del equipo',
      primary: oemFirst,
    });
  }
  if (query) {
    routes.push({
      id: 'catalog',
      label: 'Catálogo de Microsoft Update',
      url: `${MS_CATALOG}${encodeURIComponent(query)}`,
      note: query,
      primary: false,
    });
  }
  routes.push({
    id: 'wu',
    label: 'Windows Update',
    url: MS_WINDOWS_UPDATE,
    note: 'buscar actualizaciones del sistema',
    primary: false,
  });

  // Order: the primary source first, the rest in their natural order.
  routes.sort((a, b) => Number(b.primary) - Number(a.primary));
  // A whitebox PC has no OEM and may have an unknown vendor: the first route is
  // always the official one, so it must carry the marker.
  if (routes.length > 0 && !routes.some((route) => route.primary)) routes[0].primary = true;

  return {
    vendorId: chip ? chip.id : null,
    group,
    vendor: chip && chip.url ? { name: chip.name, url: chip.url } : null,
    oem: oem ? { name: oem.name, url: oem.driversUrl, support: oem.url, note: oem.note, gaming: oem.gaming } : null,
    catalogQuery: query,
    catalogUrl: query ? `${MS_CATALOG}${encodeURIComponent(query)}` : null,
    catalogHome: MS_CATALOG_HOME,
    windowsUpdateUrl: MS_WINDOWS_UPDATE,
    serial: serial || null,
    routes,
  };
}

function isAllowedUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl));
    if (url.protocol === 'ms-settings:') return String(rawUrl) === MS_WINDOWS_UPDATE;
    if (url.protocol !== 'https:') return false;
    return HOST_ALLOWLIST.has(url.hostname);
  } catch {
    return false;
  }
}

module.exports = {
  VENDORS,
  OEM_PAGES,
  CLASS_GROUPS,
  OEM_OWNED_GROUPS,
  MS_CATALOG,
  MS_CATALOG_HOME,
  HOST_ALLOWLIST,
  resolveLinks,
  oemFor,
  chipFor,
  groupFor,
  catalogQueryFor,
  isAllowedUrl,
};
