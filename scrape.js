const LIST_PAGES = 10;

// В каталог берём только автомобили
// 2020 года и новее
const MIN_CAR_YEAR = 2020;

// За один запуск добавляем максимум
// 15 новых подходящих автомобилей
const MAX_NEW_CARS_PER_RUN = 15;

// Повторно пробуем получить цену
// для машин, у которых CHE168
// временно не отдал китайскую цену
const MAX_PRICE_RETRIES_PER_RUN = 4;

// На первом этапе держим
// до 500 автомобилей в базе
const CATALOG_LIMIT = 500;


function firstMatch(text, regex) {

  if (!text) return null;

  const match = text.match(regex);

  return match
    ? match[1].trim()
    : null;
}


function cleanName(value) {

  if (!value) return null;

  const parts =
    value
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ');


  /*
  Audi Audi Q3 -> Audi Q3
  BMW BMW X3 -> BMW X3
  */

  if (
    parts.length > 1 &&
    parts[0].toLowerCase() ===
    parts[1].toLowerCase()
  ) {

    parts.splice(1, 1);

  }


  return parts.join(' ');
}


function normalizeFuel(value) {

  if (!value) return null;

  const v =
    value.toLowerCase();


  if (
    v.includes('plug-in') ||
    v.includes('hybrid')
  ) {
    return 'Гибрид';
  }


  if (
    v.includes('electric')
  ) {
    return 'Электро';
  }


  if (
    v.includes('diesel')
  ) {
    return 'Дизель';
  }


  if (
    v.includes('gasoline')
  ) {
    return 'Бензин';
  }


  return value;
}


function normalizeTransmission(value) {

  if (!value) return null;

  const v =
    value.toLowerCase();


  if (
    v.includes('dual-clutch') ||
    v.includes('dct') ||
    v.includes('dsg')
  ) {
    return 'Робот';
  }


  if (
    v.includes('cvt')
  ) {
    return 'Вариатор';
  }


  if (
    v.includes('automatic') ||
    v.includes('speed at')
  ) {
    return 'Автомат';
  }


  if (
    v.includes('manual')
  ) {
    return 'Механика';
  }


  return value;
}


function normalizeDrive(value) {

  if (!value) return null;

  const v =
    value.toLowerCase();


  if (
    v.includes('front-wheel') ||
    v.includes('fwd')
  ) {
    return 'Передний';
  }


  if (
    v.includes('rear-wheel') ||
    v.includes('rwd')
  ) {
    return 'Задний';
  }


  if (
    v.includes('all-wheel') ||
    v.includes('awd') ||
    v.includes('four-wheel') ||
    v.includes('4wd')
  ) {
    return 'Полный';
  }


  return value;
}


function normalizeBody(value) {

  if (!value) return null;

  const v =
    value.toLowerCase();


  if (
    v.includes('suv') ||
    v.includes('crossover')
  ) {
    return 'Кроссовер';
  }


  if (
    v.includes('sedan')
  ) {
    return 'Седан';
  }


  if (
    v.includes('mpv') ||
    v.includes('minivan')
  ) {
    return 'Минивэн';
  }


  if (
    v.includes('hatchback') ||
    v.includes('hatch')
  ) {
    return 'Хэтчбек';
  }


  if (
    v.includes('wagon') ||
    v.includes('estate')
  ) {
    return 'Универсал';
  }


  if (
    v.includes('coupe')
  ) {
    return 'Купе';
  }


  if (
    v.includes('pickup')
  ) {
    return 'Пикап';
  }


  return value;
}


function loadSavedCars() {

  if (
    !fs.existsSync('cars.json')
  ) {
    return [];
  }


  try {

    const data =
      JSON.parse(
        fs.readFileSync(
          'cars.json',
          'utf8'
        )
      );


    return Array.isArray(data)
      ? data
      : [];

  }

  catch (error) {

    console.log(
      'Не удалось прочитать cars.json:',
      error.message
    );


    return [];
  }
}


function uniqueCarPhotos(rawImages) {

  const seen =
    new Set();

  const preferred = [];
  const fallback = [];


  for (
    const src
    of rawImages
  ) {

    if (
      !src ||
      !src.includes('autoimg')
    ) {
      continue;
    }


    let clean =
      src;


    try {

      const u =
        new URL(src);

      u.search = '';

      clean =
        u.toString();

    }

    catch (_) {}


    if (
      seen.has(clean)
    ) {
      continue;
    }


    seen.add(clean);


    /*
    1400x0 — фотографии основной
    галереи автомобиля.
    */

    if (
      clean.includes('1400x0_')
    ) {

      preferred.push(clean);

    }

    else {

      fallback.push(clean);

    }

  }


  /*
  Если нормальной большой галереи нет,
  используем остальные autoimg.
  */

  return (
    preferred.length >= 3
      ? preferred
      : preferred.concat(fallback)
  ).slice(0, 20);
}



/*
==================================================
ПОИСК НОВЫХ ID
==================================================
*/

async function discoverCarIds(browser) {

  console.log(
    '\n===== ПОИСК НОВЫХ ОБЪЯВЛЕНИЙ =====\n'
  );


  const context =
    await browser.newContext({

      locale:
        'en-US',

      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/126.0.0.0 Safari/537.36',

      viewport: {
        width: 1440,
        height: 1200
      }

    });


  const page =
    await context.newPage();


  const ids = [];

  const seen =
    new Set();


  for (
    let pageNumber = 1;
    pageNumber <= LIST_PAGES;
    pageNumber++
  ) {

    /*
    sort=4 = новые объявления
    */

    const url =
      `https://global.che168.com/en/used-cars?sort=4&page=${pageNumber}`;


    try {

      console.log(
        `Список: страница ${pageNumber}`
      );


      await page.goto(
        url,
        {
          waitUntil:
            'domcontentloaded',

          timeout:
            45000
        }
      );


      await page.waitForTimeout(
        3000
      );


      /*
      Берём все ссылки вида:

      /en/detail/59231822
      */

      const hrefs =
        await page
          .locator(
            'a[href*="/en/detail/"]'
          )
          .evaluateAll(

            links =>
              links.map(
                link =>
                  link.href ||
                  link.getAttribute('href') ||
                  ''
              )

          );


      for (
        const href
        of hrefs
      ) {

        const match =
          String(href).match(
            /\/en\/detail\/(\d+)/
          );


        if (!match) {
          continue;
        }


        const id =
          match[1];


        if (
          seen.has(id)
        ) {
          continue;
        }


        seen.add(id);

        ids.push(id);

      }


      console.log(
        `Найдено ID после страницы ${pageNumber}: ${ids.length}`
      );

    }

    catch (error) {

      console.log(
        `Не удалось прочитать страницу ${pageNumber}: ${error.message}`
      );

    }

  }


  await context.close();


  console.log(
    `Всего уникальных ID: ${ids.length}`
  );


  return ids;
}



/*
==================================================
GLOBAL CHE168
ХАРАКТЕРИСТИКИ
==================================================
*/

async function scrapeGlobalCar(
  browser,
  id
) {

  const url =
    `https://global.che168.com/en/detail/${id}`;


  let lastError =
    null;


  for (
    let attempt = 1;
    attempt <= 2;
    attempt++
  ) {

    const context =
      await browser.newContext({

        locale:
          'en-US',

        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
          'AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/126.0.0.0 Safari/537.36',

        viewport: {
          width: 1440,
          height: 1200
        }

      });


    const page =
      await context.newPage();


    try {

      console.log(
        `GLOBAL ${id}: попытка ${attempt}`
      );


      await page.goto(
        url,
        {
          waitUntil:
            'domcontentloaded',

          timeout:
            45000
        }
      );


      await page.waitForTimeout(
        3500
      );


      const text =
        await page
          .locator('body')
          .innerText({
            timeout:
              15000
          });


      if (
        !text ||
        text.length < 500
      ) {

        throw new Error(
          'слишком мало данных'
        );

      }


      /*
      НАЗВАНИЕ
      */

      let name =
        null;


      try {

        const h1 =
          page
            .locator('h1')
            .first();


        if (
          await h1.count()
        ) {

          name =
            (
              await h1.innerText()
            ).trim();

        }

      }

      catch (_) {}


      name =
        cleanName(name);


      /*
      ГОД
      */

      const registrationDate =
        firstMatch(
          text,
          /1st Reg\. Date\s+(\d{4}\.\d{2})/i
        );


      const year =
        registrationDate
          ? Number(
              registrationDate.slice(
                0,
                4
              )
            )
          : null;


      /*
      ПРОБЕГ
      */

      const mileageRaw =
        firstMatch(
          text,
          /Mileage \(km\)\s*([\d,]+)/i
        );


      const mileage =
        mileageRaw
          ? Number(
              mileageRaw.replace(
                /,/g,
                ''
              )
            )
          : null;


      /*
      ДВИГАТЕЛЬ И МОЩНОСТЬ
      */

      const engineMatch =
        text.match(
          /Engine \(cc\)\s*([0-9.]+[TL]?)\s*(\d+)\s*(?:HP|PS)/i
        );


      let engine =
        null;

      let engineVolume =
        null;

      let engineVolumeCc =
        null;

      let power =
        null;


      if (
        engineMatch
      ) {

        engine =
          engineMatch[1];


        power =
          Number(
            engineMatch[2]
          );


        const volumeMatch =
          engine.match(
            /([0-9.]+)/
          );


        if (
          volumeMatch
        ) {

          engineVolume =
            Number(
              volumeMatch[1]
            );


          engineVolumeCc =
            Math.round(
              engineVolume *
              1000
            );

        }

      }


      const fuelRaw =
        firstMatch(
          text,
          /Fuel Type\s*([^\n]+)/i
        );


      const transmissionRaw =
        firstMatch(
          text,
          /Trans\.\s*([^\n]+)/i
        );


      const driveRaw =
        firstMatch(
          text,
          /Drive Train\s*([^\n]+)/i
        );


      const bodyRaw =
        firstMatch(
          text,
          /Body Type\s*([^\n]+)/i
        );


      /*
      ФОТО
      */

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


      const photos =
        uniqueCarPhotos(
          rawImages
        );


      await context.close();


      return {

        id,

        country:
          'Китай',

        source:
          'CHE168',

        globalUrl:
          url,

        name,

        registrationDate,

        year,

        mileage,

        engine,

        engineVolume,

        engineVolumeCc,

        power,

        /*
        ВАЖНО:
        160 л.с. не включаем.
        Только до 159 включительно.
        */

        preferentialPower:
          power !== null
            ? power <= 159
            : null,

        transmission:
          normalizeTransmission(
            transmissionRaw
          ),

        drive:
          normalizeDrive(
            driveRaw
          ),

        fuel:
          normalizeFuel(
            fuelRaw
          ),

        body:
          normalizeBody(
            bodyRaw
          ),

        photo:
          photos[0] || null,

        photosCount:
          photos.length,

        photos

      };

    }

    catch (error) {

      lastError =
        error;


      console.log(
        `GLOBAL ${id}: ${error.message}`
      );


      await context.close();


      if (
        attempt < 2
      ) {

        await new Promise(

          resolve =>
            setTimeout(
              resolve,
              2500
            )

        );

      }

    }

  }


  throw lastError;
}



/*
==================================================
КИТАЙСКАЯ ЦЕНА
==================================================
*/

async function scrapeChinaPrice(
  browser,
  id
) {

  const url =
    `https://pcm.che168.com/2023/cardetail_rn/index?infoid=${id}&pvareaid=108991`;


  const strategies = [

    {

      name:
        'desktop',

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

      name:
        'mobile',

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

    const context =
      await browser.newContext({

        locale:
          'zh-CN',

        timezoneId:
          'Asia/Shanghai',

        userAgent:
          strategy.userAgent,

        viewport:
          strategy.viewport,

        extraHTTPHeaders: {

          'Accept-Language':
            'zh-CN,zh;q=0.9',

          'Referer':
            'https://www.che168.com/'

        }

      });


    const page =
      await context.newPage();


    try {

      console.log(
        `PRICE ${id}: ${strategy.name}`
      );


      await page.goto(
        url,
        {
          waitUntil:
            'commit',

          timeout:
            20000
        }
      );


      await page.waitForTimeout(
        6500
      );


      const text =
        await page
          .locator('body')
          .innerText({
            timeout:
              9000
          });


      /*
      Цена непосредственно перед
      新车含税价
      */

      const priceMatch =
        text.match(
          /(?:^|\n)\s*(\d+(?:\.\d+)?)\s*\n?\s*万\s*\n?\s*新车含税价/
        );


      if (
        priceMatch
      ) {

        const priceWan =
          Number(
            priceMatch[1]
          );


        const priceCny =
          Math.round(
            priceWan *
            10000
          );


        console.log(
          `PRICE ${id}: ${priceCny} ¥`
        );


        await context.close();


        return {

          priceCny,

          priceWan,

          priceSource:
            'CHE168 live',

          priceUpdatedAt:
            new Date()
              .toISOString(),

          chinaUrl:
            url

        };

      }

    }

    catch (error) {

      console.log(
        `PRICE ${id} ${strategy.name}: ${error.message}`
      );

    }


    await context.close();

  }


  return {

    priceCny:
      null,

    priceWan:
      null,

    priceSource:
      null,

    priceUpdatedAt:
      null,

    chinaUrl:
      url

  };
}



/*
==================================================
ЗАПУСК
==================================================
*/

(async () => {

  const savedCars =
  loadSavedCars()
    .filter(
      car =>
        Number(car.year) >=
        MIN_CAR_YEAR
    );


  const carsById =
    new Map(

      savedCars.map(

        car => [
          String(car.id),
          car
        ]

      )

    );


  const browser =
    await chromium.launch({
      headless:
        true
    });


  try {

    /*
    1. Получаем свежие объявления
    */

    const discoveredIds =
      await discoverCarIds(
        browser
      );


    /*
    2. Сколько ещё мест осталось
    до 50 машин
    */

    const freeSlots =
      Math.max(
        0,
        CATALOG_LIMIT -
        savedCars.length
      );


    /*
    3. Берём только машины,
    которых ещё нет в cars.json
    */

    const newIds =
      discoveredIds

        .filter(
          id =>
            !carsById.has(id)
        )

        .slice(
          0,
          Math.min(
            MAX_NEW_CARS_PER_RUN,
            freeSlots
          )
        );


    /*
    4. Машины без цены
    пробуем повторно
    */

    const retryPriceIds =
      savedCars

        .filter(
          car =>
            car.priceCny === null ||
            car.priceCny === undefined
        )

        .map(
          car =>
            String(car.id)
        )

        .slice(
          0,
          MAX_PRICE_RETRIES_PER_RUN
        );


    console.log(
      '\n===== ПЛАН ЭТОГО ЗАПУСКА ====='
    );


    console.log(
      'Новых машин:',
      newIds.length,
      newIds
    );


    console.log(
      'Повтор цены:',
      retryPriceIds.length,
      retryPriceIds
    );


    /*
    5. Добавляем новые машины
    */

    for (
      const id
      of newIds
    ) {

      console.log(
        `\n===== НОВАЯ МАШИНА ${id} =====`
      );


      try {

        const details =
  await scrapeGlobalCar(
    browser,
    id
  );


/*
==================================================
ФИЛЬТР ПО ГОДУ
==================================================

Каталог VAN AUTO:
только автомобили 2020 года
и новее.

Если год не удалось определить,
такую машину тоже пока не добавляем.
*/

if (
  !details.year ||
  Number(details.year) <
  MIN_CAR_YEAR
) {

  console.log(
    `Машина ${id} пропущена: год ${details.year || 'не определён'}`
  );

  continue;

}


const price =
  await scrapeChinaPrice(
    browser,
    id
  );


        const price =
          await scrapeChinaPrice(
            browser,
            id
          );


        carsById.set(

          id,

          {

            ...details,

            chinaUrl:
              price.chinaUrl,

            priceWan:
              price.priceWan,

            priceCny:
              price.priceCny,

            priceSource:
              price.priceSource,

            priceUpdatedAt:
              price.priceUpdatedAt,

            addedAt:
              new Date()
                .toISOString(),

            lastSeenAt:
              new Date()
                .toISOString(),

            status:
              'active'

          }

        );

      }

      catch (error) {

        console.log(
          `Машина ${id} пропущена: ${error.message}`
        );

      }

    }


    /*
    6. Повторно пробуем
    получить цены
    */

    for (
      const id
      of retryPriceIds
    ) {

      if (
        newIds.includes(id)
      ) {
        continue;
      }


      console.log(
        `\n===== ПОВТОР ЦЕНЫ ${id} =====`
      );


      const previous =
        carsById.get(id);


      if (
        !previous
      ) {
        continue;
      }


      const price =
        await scrapeChinaPrice(
          browser,
          id
        );


      if (
        price.priceCny !== null
      ) {

        carsById.set(

          id,

          {

            ...previous,

            chinaUrl:
              price.chinaUrl,

            priceWan:
              price.priceWan,

            priceCny:
              price.priceCny,

            priceSource:
              price.priceSource,

            priceUpdatedAt:
              price.priceUpdatedAt

          }

        );

      }

    }


    /*
    7. Сохраняем всю базу
    */

    const result =
      Array.from(
        carsById.values()
      );


    fs.writeFileSync(

      'cars.json',

      JSON.stringify(
        result,
        null,
        2
      ) + '\n',

      'utf8'

    );


    console.log(
      '\n================================'
    );


    console.log(
      `cars.json сохранён. Всего машин: ${result.length}`
    );


    console.log(
      '================================\n'
    );

  }

  finally {

    await browser.close();

  }

})();
