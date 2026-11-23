import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { ProductQueryDto } from './dto/product-query.dto';
import { Public } from '../decorators/public.decorator';

// The whole storefront catalog is public. Personalisation (wishlist state,
// member pricing) is layered on by the client using /auth/me, so these
// responses stay cacheable.
@ApiTags('catalog')
@Public()
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('products')
  @ApiOperation({ summary: 'List products with filtering, sorting and paging' })
  listProducts(@Query() query: ProductQueryDto) {
    return this.catalog.listProducts(query);
  }

  @Get('products/:slug')
  @ApiOperation({ summary: 'Product detail with the full variant matrix' })
  getProduct(@Param('slug') slug: string) {
    return this.catalog.getProductBySlug(slug);
  }

  @Get('filters')
  @ApiOperation({
    summary: 'Facet values available within the current filters',
  })
  getFilters(@Query() query: ProductQueryDto) {
    return this.catalog.getFilters(query);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Nested category tree for navigation' })
  getCategories() {
    return this.catalog.getCategoryTree();
  }

  @Get('size-guides')
  @ApiOperation({ summary: 'Every published size guide, by category' })
  listSizeGuides() {
    return this.catalog.listSizeGuides();
  }

  @Get('collections')
  @ApiOperation({ summary: 'Active merchandising collections' })
  listCollections() {
    return this.catalog.listCollections();
  }

  @Get('collections/:slug')
  @ApiOperation({ summary: 'A collection and the products inside it' })
  getCollection(@Param('slug') slug: string, @Query() query: ProductQueryDto) {
    return this.catalog.getCollectionBySlug(slug, query);
  }
}
