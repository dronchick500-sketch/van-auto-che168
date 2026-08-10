const { chromium } = require('playwright');
const fs = require('fs');

(async () => {

  const CAR_ID = '59231822';

  const url =
    `https://pcm.che168.com/2023/cardetail_rn/index?infoid=${CAR_ID}&pvareaid=108991`;


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
      },

      locale: 'zh-CN'
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
      },

      locale: 'zh-CN'
    },


    {
      name: 'crawler',

      userAgent:
        'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',

      viewport: {
        width: 1440,
        height: 1200
      },

      locale: 'zh-CN'
    }

  ];


  const browser = await chromium.launch({
    headless: true
  });
  const networkCandidates = [];


  let successfulResult = null;


  for (const strategy of strategies) {

    console.log(
      `\n===== ПРОБУЕМ: ${strategy.name} =====\n`
    );


    const context = await browser.newContext({

      locale: strategy.locale,

      userAgent: strategy.userAgent,

      viewport: strategy.viewport,

      timezoneId: 'Asia/Shanghai',

      extraHTTPHeaders: {
        'Accept-Language':
          'zh-CN,zh;q=0.9,en;q=0.7',

        'Referer':
          'https://www.che168.com/'
      }

    });


    const page = await context.newPage();
    page.on('response', async (response) => {

  try {

    const request = response.request();
    const type = request.resourceType();

    if (
      type !== 'xhr' &&
      type !== 'fetch'
    ) {
      return;
    }

    const contentType =
      response.headers()['content-type'] || '';


    const body =
      await response.text();


    if (
      !body ||
      body.length > 2000000
    ) {
      return;
    }


    /*
      Нас интересуют ответы,
      где потенциально может лежать
      мощность двигателя.
    */

    if (
      !/最大马力|马力|最大功率|horsepower|maxHorsepower|maxPower|power|kw/i
        .test(body)
    ) {
      return;
    }


    networkCandidates.push({

      url: response.url(),

      status: response.status(),

      type,

      contentType,

      body: body.slice(0, 200000)

    });


  } catch (error) {

    /*
      Некоторые ответы браузер
      не даст прочитать.
      Это нормально.
    */

  }

});
const networkCandidates = [];

page.on('response', async (response) => {

  try {

    const request = response.request();
    const type = request.resourceType();

    const headers = response.headers();

    const contentType =
      headers['content-type'] || '';

    if (
      type !== 'xhr' &&
      type !== 'fetch' &&
      !contentType.includes('json')
    ) {
      return;
    }

    const body =
      await response.text();

    if (!body || body.length > 2000000) {
      return;
    }

    const interesting =
      /最大马力|马力|最大功率|horsepower|maxHorsepower|maxPower|power|kw/i
        .test(body);

    if (!interesting) {
      return;
    }

    networkCandidates.push({

      url: response.url(),

      status: response.status(),

      contentType,

      body: body.slice(0, 200000)

    });

  } catch (error) {

    // отдельный сетевой запрос
    // не должен ломать весь парсер

  }

});

    /*
      Слегка приближаем браузер
      к обычному пользовательскому.
    */

    await page.addInitScript(() => {

      Object.defineProperty(
        navigator,
        'webdriver',
        {
          get: () => undefined
        }
      );

    });


    try {

      await page.goto(url, {
        waitUntil: 'commit',
        timeout: 45000
      });


      await page.waitForTimeout(12000);


      const title =
        await page.title();


      const finalUrl =
        page.url();


      let text = '';

      try {

        text =
          await page.locator('body').innerText({
            timeout: 10000
          });

      } catch (error) {

        text = '';

      }


      const html =
        await page.content();


      console.log(
        'TITLE:',
        JSON.stringify(title)
      );

      console.log(
        'FINAL URL:',
        finalUrl
      );

      console.log(
        'TEXT LENGTH:',
        text.length
      );

      console.log(
        '\n----- ТЕКСТ СТРАНИЦЫ -----\n'
      );

      console.log(
        JSON.stringify(
          text.slice(0, 1500)
        )
      );


      /*
        Сохраняем диагностику
        для КАЖДОЙ стратегии.
      */

      fs.writeFileSync(
        `debug-${strategy.name}.html`,
        html,
        'utf8'
      );


      fs.writeFileSync(
        `debug-${strategy.name}.txt`,
        text,
        'utf8'
      );


      await page.screenshot({
        path:
          `debug-${strategy.name}.png`,
        fullPage: true
      });


      /*
        Проверяем,
        получили ли настоящую карточку.
      */

      const isRealCarPage =

        text.length > 1000 &&

        (
          text.includes('上牌时间') ||
          text.includes('表显里程') ||
          text.includes('发动机排量')
        );


      if (isRealCarPage) {

        console.log(
          `\nУСПЕХ: ${strategy.name}\n`
        );


        successfulResult = {
          page,
          context,
          text,
          html,
          strategy: strategy.name
        };


        break;

      }


    } catch (error) {

      console.log(
        'Ошибка стратегии:',
        strategy.name
      );

      console.log(
        error.message
      );

    }


    await context.close();

  }


  /*
    Если ни одна стратегия
    не получила карточку —
    НЕ роняем workflow.

    Нам нужны сохранённые
    txt/html/png для диагностики.
  */

  if (!successfulResult) {

    console.log(
      '\n===== КАРТОЧКА НЕ ПОЛУЧЕНА =====\n'
    );

    console.log(
      'Диагностика сохранена.'
    );


    await browser.close();

    process.exit(0);

  }


  const {
    page,
    context,
    text,
    html,
    strategy
  } = successfulResult;


  console.log(
    '\n===== НАЧИНАЕМ ПАРСИНГ =====\n'
  );


  function firstMatch(regex, source = text) {

    const match =
      source.match(regex);

    return match
      ? match[1].trim()
      : null;

  }


  function numberOrNull(value) {

    if (
      value === null ||
      value === undefined
    ) {

      return null;

    }


    const n =
      Number(value);


    return Number.isFinite(n)
      ? n
      : null;

  }


  /* НАЗВАНИЕ */

  let name =
    firstMatch(
      /好车\s+([^\n]+?)\s+投诉/
    );


  if (!name) {

    name =
      firstMatch(
        /(奥迪[^\n]{2,80})/
      );

  }


  /* ЦЕНА */

  const priceWan =
    numberOrNull(
      firstMatch(
        /(?:^|\n)\s*(\d+(?:\.\d+)?)\s*\n?\s*万\s*\n?\s*新车含税价/
      )
    );


  const priceCny =
    priceWan !== null
      ? Math.round(
          priceWan * 10000
        )
      : null;


  /* РЕГИСТРАЦИЯ */

  const registrationDate =
    firstMatch(
      /(\d{4}-\d{2})\s*\n?\s*上牌时间/
    );


  const year =
    registrationDate
      ? Number(
          registrationDate.slice(0, 4)
        )
      : null;


  /* ПРОБЕГ */

  const mileageWan =
    numberOrNull(
      firstMatch(
        /(\d+(?:\.\d+)?)\s*万公里\s*\n?\s*表显里程/
      )
    );


  const mileage =
    mileageWan !== null
      ? Math.round(
          mileageWan * 10000
        )
      : null;


  /* ОБЪЁМ */

  const engineVolume =
    numberOrNull(
      firstMatch(
        /(\d+(?:\.\d+)?)L\s*\n?\s*发动机排量/
      )
    );


  const engineVolumeCc =
    engineVolume !== null
      ? Math.round(
          engineVolume * 1000
        )
      : null;


  /* КОРОБКА */

  const transmissionCn =
    firstMatch(
      /([^\n]+)\s*\n\s*变速箱/
    );


  const transmissionMap = {

    '自动': 'Автомат',

    '手动': 'Механика'

  };


  const transmission =

    transmissionMap[
      transmissionCn
    ]

    || transmissionCn;


  /* ПРИВОД */

  const driveCn =
    firstMatch(
      /([^\n]+)\s*\n\s*驱动方式/
    );


  const driveMap = {

    '前置前驱':
      'Передний',

    '前置后驱':
      'Задний',

    '前置四驱':
      'Полный',

    '中置后驱':
      'Задний',

    '后置后驱':
      'Задний'

  };


  const drive =

    driveMap[
      driveCn
    ]

    || driveCn;


  /* ТОПЛИВО */

  const fuelCn =
    firstMatch(
      /([^\n]+)\s*\n\s*燃料形式/
    );


  const fuelMap = {

    '汽油':
      'Бензин',

    '柴油':
      'Дизель',

    '纯电动':
      'Электро',

    '插电式混合动力':
      'Гибрид',

    '油电混合':
      'Гибрид'

  };


  const fuel =

    fuelMap[
      fuelCn
    ]

    || fuelCn;


  /* МОЩНОСТЬ */

  const powerCandidates = [];


  const powerPatterns = [

    /最大马力[^0-9]{0,30}(\d{2,4})/g,

    /(\d{2,4})\s*马力/g,

    /"horsepower"\s*:\s*"?(\d{2,4})/g,

    /"maxHorsepower"\s*:\s*"?(\d{2,4})/g

  ];


  for (
    const regex
    of powerPatterns
  ) {

    let match;


    while (
      (
        match =
          regex.exec(html)
      ) !== null
    ) {

      const value =
        Number(match[1]);


      if (
        value >= 50 &&
        value <= 1500 &&
        !powerCandidates.includes(
          value
        )
      ) {

        powerCandidates.push(
          value
        );

      }

    }

  }


  let power = null;


  if (
    powerCandidates.length === 1
  ) {

    power =
      powerCandidates[0];

  }


  /* ФОТО */

  const rawImages =
    await page
      .locator('img')
      .evaluateAll(
        images =>
          images.map(
            img =>
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
        .filter(
          src =>
            src.includes(
              'autoimg'
            )
            ||
            src.includes(
              'che168'
            )
        )

    )

  ];


  const car = {

    id: CAR_ID,

    source:
      'CHE168',

    strategy,

    sourceUrl:
      url,

    name,

    priceWan,

    priceCny,

    registrationDate,

    year,

    mileage,

    engineVolume,

    engineVolumeCc,

    power,

    powerCandidates,

    preferentialPower:

      power !== null
        ? power <= 159
        : null,

    transmission,

    drive,

    fuel,

    photosCount:
      photos.length,

    photos:
      photos.slice(0, 20)

  };

fs.writeFileSync(
  'network-candidates.json',
  JSON.stringify(
    networkCandidates,
    null,
    2
  ),
  'utf8'
);

console.log(
  '\n===== СЕТЕВЫЕ КАНДИДАТЫ =====\n'
);

console.log(
  'Найдено ответов:',
  networkCandidates.length
);

networkCandidates
  .slice(0, 20)
  .forEach(function(item, index) {

    console.log(
      `\n--- ${index + 1} ---`
    );

    console.log(
      item.url
    );

    console.log(
      item.body.slice(0, 1500)
    );

  });
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


  await context.close();

  await browser.close();

})();
