import { Global, Module } from '@nestjs/common';
import { PaystackService } from './paystack.service';
import { PaymentsService } from './payments.service';
import { WebhookController } from './webhook.controller';

@Global()
@Module({
  controllers: [WebhookController],
  providers: [PaystackService, PaymentsService],
  exports: [PaystackService, PaymentsService],
})
export class PaymentsModule {}
