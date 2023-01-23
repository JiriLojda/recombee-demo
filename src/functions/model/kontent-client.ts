import { IContentItem, IContentType, DeliveryClient } from '@kontent-ai/delivery-sdk';
import { KontentConfiguration } from './configuration-model';
import packageJson from '../../../package.json';

export default class KontentClient {
  client: DeliveryClient
  config: KontentConfiguration

  constructor(config: KontentConfiguration) {
    this.client = new DeliveryClient({
      projectId: config.projectId,
      globalHeaders: () => [{ header: 'X-KC-SOURCE', value: `${packageJson.name};${packageJson.version}`}],
    });
    this.config = config;
  }

  getContentType(): Promise<IContentType> {
    return this.client.type(this.config.contentType)
      .toPromise()
      .then(r => r.data.type);
  }

  getAllContentItemsOfType(): Promise<IContentItem[]> {
    if (!this.config.language) {
      return Promise.resolve([]);
    }
    return this.client
      .itemsFeed()
      .type(this.config.contentType)
      .queryConfig({ waitForLoadingNewContent: true })
      .languageParameter(this.config.language)
      .equalsFilter("system.language", this.config.language)
      .toPromise()
      .then(r => r.data.items);
  }

  getContentForCodename(codename: string): Promise<IContentItem | null> {
    if (!this.config.language) {
      return Promise.resolve(null);
    }

    return this.client
      .item(codename)
      .queryConfig({ waitForLoadingNewContent: true })
      .languageParameter(this.config.language)
      .toPromise()
      .then(r => {
        return r.data.item
      });
  }
}

