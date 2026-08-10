const { chromium } = require('playwright');
const fs = require('fs');

(async () => {

  const CAR_ID = '59231822';

  const url =
    `https://pcm.che168.com/2023/cardetail_rn/index?infoid=${CAR_ID}&pvareaid=108991`;

  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    locale: 'zh-CN',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/126.0.0.0 Safari/537.36',
    viewport: {
      width: 1440,
      height: 1200
    }
  });

  const page = await context.newPage();

  console.log('Открываем CHE168...');

  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  await page.waitForTimeout(10000);

  const text = await page.locator('body').innerText();
  const html = await page.content();


  /* ==============================
     ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
     ============================== */

  function firstMatch(regex, source = text) {
    const match = source.match(regex);
    return match ? match[1].trim() : null;
  }

  function numberOrNull(value) {
    if (value === null || value === undefined) {
      return null;
    }

    const n = Number(value);

    return Number.isFinite(n)
      ? n
      : null;
  }


  /* ==============================
     НАЗВАНИЕ
     ============================== */

  let name =
    firstMatch(/好车\s+([^\n]+?)\s+投诉/);

  if (!name) {
    name =
      firstMatch(
        /(奥迪[^\n]{2,80})/
      );
  }


  /* ==============================
     ЦЕНА АВТОМОБИЛЯ

     Берём именно главную цену
     перед "新车含税价"
     ============================== */

  const priceWan =
    numberOrNull(
      firstMatch(
        /(?:^|\n)\s*(\d+(?:\.\d+)?)\s*\n?\s*万\s*\n?\s*新车含税价/
      )
    );

  const priceCny =
    priceWan !== null
      ? Math.round(priceWan * 10000)
      : null;


  /* ==============================
     ЦЕНА НОВОЙ МАШИНЫ
     НЕ ИСПОЛЬЗУЕМ В РАСЧЁТЕ
     ============================== */

  const newPriceWan =
    numberOrNull(
      firstMatch(
        /新车含税价[：:]\s*(\d+(?:\.\d+)?)\s*万/
      )
    );


  /* ==============================
     ДАТА РЕГИСТРАЦИИ
     ============================== */

  const registrationDate =
    firstMatch(
      /(\d{4}-\d{2})\s*\n?\s*上牌时间/
    );


  const year =
    registrationDate
      ? Number(registrationDate.slice(0, 4))
      : null;


  /* ==============================
     ПРОБЕГ
     4.35万 км → 43 500 км
     ============================== */

  const mileageWan =
    numberOrNull(
      firstMatch(
        /(\d+(?:\.\d+)?)\s*万公里\s*\n?\s*表显里程/
      )
    );

  const mileage =
    mileageWan !== null
      ? Math.round(mileageWan * 10000)
      : null;


  /* ==============================
     ОБЪЁМ
     ============================== */

  const engineVolume =
    numberOrNull(
      firstMatch(
        /(\d+(?:\.\d+)?)L\s*\n?\s*发动机排量/
      )
    );

  const engineVolumeCc =
    engineVolume !== null
      ? Math.round(engineVolume * 1000)
      : null;


  /* ==============================
     КОРОБКА
     ============================== */

  const transmissionCn =
    firstMatch(
      /([^\n]+)\s*\n\s*变速箱/
    );


  const transmissionMap = {
    '自动': 'Автомат',
    '手动': 'Механика'
  };

  const transmission =
    transmissionMap[transmissionCn]
    || transmissionCn;


  /* ==============================
     ПРИВОД
     ============================== */

  const driveCn =
    firstMatch(
      /([^\n]+)\s*\n\s*驱动方式/
    );


  const driveMap = {
    '前置前驱': 'Передний',
    '前置后驱': 'Задний',
    '前置四驱': 'Полный',
    '中置后驱': 'Задний',
    '后置后驱': 'Задний'
  };

  const drive =
    driveMap[driveCn]
    || driveCn;


  /* ==============================
     ТОПЛИВО
     ============================== */

  const fuelCn =
    firstMatch(
      /([^\n]+)\s*\n\s*燃料形式/
    );


  const fuelMap = {
    '汽油': 'Бензин',
    '柴油': 'Дизель',
    '纯电动': 'Электро',
    '插电式混合动力': 'Гибрид',
    '油电混合': 'Гибрид'
  };

  const fuel =
    fuelMap[fuelCn]
    || fuelCn;


  /* ==============================
     ЭКОЛОГИЧЕСКИЙ СТАНДАРТ
     ============================== */

  const emission =
    firstMatch(
      /([^\n]+)\s*\n\s*排放标准/
    );


  /* ==============================
     РЕГИОН
     ============================== */

  const location =
    firstMatch(
      /([^\n]+)\s*\n\s*所在地区/
    );


  /* ==============================
     МОЩНОСТЬ

     Ищем несколькими способами.
     ============================== */

  const powerCandidates = [];

  const powerPatterns = [
    /最大马力[^0-9]{0,30}(\d{2,4})/g,
    /(\d{2,4})\s*马力/g,
    /"horsepower"\s*:\s*"?(\d{2,4})/g,
    /"maxHorsepower"\s*:\s*"?(\d{2,4})/g
  ];

  for (const regex of powerPatterns) {

    let match;

    while ((match = regex.exec(html)) !== null) {

      const value = Number(match[1]);

      if (
        value >= 50 &&
        value <= 1500 &&
        !powerCandidates.includes(value)
      ) {
        powerCandidates.push(value);
      }

    }

  }


  let power = null;

  if (powerCandidates.length === 1) {
    power = powerCandidates[0];
  }


  /* ==============================
     ФОТОГРАФИИ
     ============================== */

  const rawImages =
    await page.locator('img').evaluateAll(
      images => images.map(img =>
        img.currentSrc ||
        img.src ||
        img.dataset.src ||
        img.dataset.original ||
        ''
      )
    );


  const photos = [
    ...new Set(
      rawImages
        .filter(Boolean)
        .filter(src =>
          src.includes('autoimg')
          || src.includes('che168')
        )
    )
  ];


  /* ==============================
     ЛЬГОТНЫЙ ФИЛЬТР МОЩНОСТИ

     UI: "До 160 л.с."
     Фактически: <=159
     ============================== */

  const preferentialPower =
    power !== null
      ? power <= 159
      : null;


  /* ==============================
     ГОТОВЫЙ ОБЪЕКТ
     ============================== */

  const car = {

    id: CAR_ID,

    source: 'CHE168',

    sourceUrl: url,

    name,

    priceWan,
    priceCny,

    newPriceWan,

    registrationDate,
    year,

    mileage,

    engineVolume,
    engineVolumeCc,

    power,
    powerCandidates,

    preferentialPower,

    transmission,

    drive,

    fuel,

    emission,

    location,

    photosCount:
      photos.length,

    photos:
      photos.slice(0, 20)

  };


  fs.writeFileSync(
    'car.json',
    JSON.stringify(car, null, 2),
    'utf8'
  );


  fs.writeFileSync(
    'che168.html',
    html,
    'utf8'
  );


  await page.screenshot({
    path: 'che168.png',
    fullPage: true
  });


  console.log(
    '\n===== ГОТОВЫЙ АВТОМОБИЛЬ =====\n'
  );

  console.log(
    JSON.stringify(
      car,
      null,
      2
    )
  );


  await browser.close();

})();
