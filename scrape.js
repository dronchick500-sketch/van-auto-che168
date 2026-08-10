const { chromium } = require('playwright');
const fs = require('fs');

(async () => {

  const CAR_ID = '59231822';

  const GLOBAL_URL =
    `https://global.che168.com/en/detail/${CAR_ID}`;

  const CHINA_URL =
    `https://pcm.che168.com/2023/cardetail_rn/index?infoid=${CAR_ID}&pvareaid=108991`;


  const browser = await chromium.launch({
    headless: true
  });


  function numberOrNull(value) {

    if (value === null || value === undefined) {
      return null;
    }

    const n = Number(value);

    return Number.isFinite(n)
      ? n
      : null;
  }


  function firstMatch(text, regex) {

    const match = text.match(regex);

    return match
      ? match[1].trim()
      : null;
  }


  /*
  ========================================
  1. GLOBAL CHE168
  ХАРАКТЕРИСТИКИ + МОЩНОСТЬ
  ========================================
  */

  console.log(
    '\n===== GLOBAL CHE168 =====\n'
  );


  const globalContext =
    await browser.newContext({

      locale: 'en-US',

      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/126.0.0.0 Safari/537.36',

      viewport: {
        width: 1440,
        height: 1200
      }

    });


  const globalPage =
    await globalContext.newPage();


  await globalPage.goto(
    GLOBAL_URL,
    {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    }
  );


  await globalPage.waitForTimeout(
    5000
  );


  const globalText =
    await globalPage
      .locator('body')
      .innerText();


  const globalHtml =
    await globalPage.content();


  console.log(
    'Global text:',
    globalText.length
  );


  /*
  Название
  */

  let name =
    firstMatch(
      globalText,
      /Home\s*\/.*?\n([^\n]+)\nPrice/
    );


  if (!name) {

    name =
      firstMatch(
        globalText,
        /#?\s*(Audi[^\n]+)/i
      );

  }


  /*
  Дата первой регистрации
  */

  const registrationDate =
    firstMatch(
      globalText,
      /1st Reg\. Date\s+(\d{4}\.\d{2})/i
    );


  const year =
    registrationDate
      ? Number(
          registrationDate.slice(0, 4)
        )
      : null;


  /*
  Пробег
  */

  const mileageRaw =
    firstMatch(
      globalText,
      /Mileage \(km\)\s*([\d,]+)/i
    );


  const mileage =
    mileageRaw
      ? Number(
          mileageRaw.replace(/,/g, '')
        )
      : null;


  /*
  Двигатель и мощность

  Пример:
  1.4T 150HP L4
  */

  const engineMatch =
    globalText.match(
      /Engine \(cc\)\s*([0-9.]+[TL]?)\s*(\d+)\s*HP/i
    );


  let engine = null;
  let engineVolume = null;
  let engineVolumeCc = null;
  let power = null;


  if (engineMatch) {

    engine =
      engineMatch[1];

    power =
      Number(engineMatch[2]);


    const volumeMatch =
      engine.match(
        /([0-9.]+)/
      );


    if (volumeMatch) {

      engineVolume =
        Number(volumeMatch[1]);

      engineVolumeCc =
        Math.round(
          engineVolume * 1000
        );

    }

  }


  /*
  Топливо
  */

  const fuelEn =
    firstMatch(
      globalText,
      /Fuel Type\s*([^\n]+)/i
    );


  const fuelMap = {

    'Gasoline':
      'Бензин',

    'Diesel':
      'Дизель',

    'Electric':
      'Электро',

    'Hybrid':
      'Гибрид',

    'Plug-in Hybrid':
      'Гибрид'

  };


  const fuel =
    fuelMap[fuelEn]
    || fuelEn;


  /*
  Коробка
  */

  const transmission =
    firstMatch(
      globalText,
      /Trans\.\s*([^\n]+)/i
    );


  /*
  Привод
  */

  const driveEn =
    firstMatch(
      globalText,
      /Drive Train\s*([^\n]+)/i
    );


  const driveMap = {

    'Front-Wheel Drive (FWD)':
      'Передний',

    'Rear-Wheel Drive (RWD)':
      'Задний',

    'All-Wheel Drive (AWD)':
      'Полный',

    'Four-Wheel Drive (4WD)':
      'Полный'

  };


  const drive =
    driveMap[driveEn]
    || driveEn;


  /*
  Кузов
  */

  const bodyEn =
    firstMatch(
      globalText,
      /Body Type\s*([^\n]+)/i
    );


  let body = bodyEn;


  if (
    bodyEn &&
    /SUV|Crossover/i.test(bodyEn)
  ) {

    body =
      'Кроссовер';

  }


  if (
    bodyEn &&
    /Sedan/i.test(bodyEn)
  ) {

    body =
      'Седан';

  }


  if (
    bodyEn &&
    /MPV|Minivan/i.test(bodyEn)
  ) {

    body =
      'Минивэн';

  }


  /*
  Фотографии
  */

  const globalImages =
    await globalPage
      .locator('img')
      .evaluateAll(
        images =>
          images.map(
            img =>
              img.currentSrc ||
              img.src ||
              img.dataset.src ||
              ''
          )
      );


  const photos = [

    ...new Set(

      globalImages
        .filter(Boolean)
        .filter(
          src =>
            src.includes(
              'autoimg'
            )
        )

    )

  ];


  await globalContext.close();


  /*
  ========================================
  2. КИТАЙСКИЙ CHE168
  ТОЛЬКО ЦЕНА В ЮАНЯХ
  ========================================
  */

  console.log(
    '\n===== ЦЕНА В ЮАНЯХ =====\n'
  );


  let priceWan = null;
  let priceCny = null;
  let chinaSuccess = false;


  const strategies = [

    {
      name: 'desktop',

      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/126.0.0.0 Safari/537.36',

      viewport: {
        width: 1440,
        height: 1200
      }

    },


    {
      name: 'mobile',

      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) ' +
        'AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
        'Version/17.5 Mobile/15E148 Safari/604.1',

      viewport: {
        width: 390,
        height: 844
      }

    }

  ];


  for (
    const strategy
    of strategies
  ) {

    console.log(
      `Пробуем цену: ${strategy.name}`
    );


    const context =
      await browser.newContext({

        locale: 'zh-CN',

        userAgent:
          strategy.userAgent,

        viewport:
          strategy.viewport,

        timezoneId:
          'Asia/Shanghai'

      });


    const page =
      await context.newPage();


    try {

      /*
      Очень важно:
      китайская цена теперь
      НЕ МОЖЕТ сломать весь workflow.
      */

      await page.goto(
        CHINA_URL,
        {
          waitUntil: 'commit',
          timeout: 25000
        }
      );


      await page.waitForTimeout(
        8000
      );


      const text =
        await page
          .locator('body')
          .innerText({
            timeout: 10000
          });


      console.log(
        strategy.name,
        'text:',
        text.length
      );


      /*
      Главная цена расположена
      непосредственно перед
      "新车含税价"
      */

      const priceMatch =
        text.match(
          /(?:^|\n)\s*(\d+(?:\.\d+)?)\s*\n?\s*万\s*\n?\s*新车含税价/
        );


      if (priceMatch) {

        priceWan =
          Number(
            priceMatch[1]
          );


        priceCny =
          Math.round(
            priceWan * 10000
          );


        chinaSuccess = true;


        console.log(
          'Цена найдена:',
          priceCny,
          '¥'
        );


        await context.close();

        break;

      }


    } catch (error) {

      console.log(
        `${strategy.name}: ${error.message}`
      );

    }


    await context.close();

  }


  /*
  ========================================
  ГОТОВЫЙ ОБЪЕКТ
  ========================================
  */

  const car = {

    id:
      CAR_ID,

    source:
      'CHE168',

    globalUrl:
      GLOBAL_URL,

    chinaUrl:
      CHINA_URL,

    name,

    priceWan,

    priceCny,

    chinaPriceLoaded:
      chinaSuccess,

    registrationDate,

    year,

    mileage,

    engine,

    engineVolume,

    engineVolumeCc,

    power,

    preferentialPower:

      power !== null
        ? power <= 159
        : null,

    transmission,

    drive,

    fuel,

    body,

    photosCount:
      photos.length,

    photos:
      photos.slice(0, 20)

  };


  fs.writeFileSync(
    'car.json',

    JSON.stringify(
      car,
      null,
      2
    ),

    'utf8'
  );


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
