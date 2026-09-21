SET lock_timeout = '5s';

ALTER TABLE crm_access.crm_billing_operations
  DROP CONSTRAINT crm_billing_operations_command_type_check,
  ADD CONSTRAINT crm_billing_operations_command_type_check CHECK (
    command_type IN (
      'AEROCRM_CHECKOUT','AEROCRM_SEAT_CHANGE','AEROCRM_DISABLE_RENEWAL',
      'AEROCRM_CONFIRM_RENEWAL','AEROCRM_VERIFY_ORDER','AEROCRM_NOT_STARTED',
      'ADMIN_SET_AEROCRM_SEATS'
    )
  );

ALTER TABLE crm_access.crm_billing_operations
  DROP CONSTRAINT crm_billing_operations_condition_2_check,
  ADD CONSTRAINT crm_billing_operations_condition_2_check CHECK (
    (command_type IN ('AEROCRM_CHECKOUT','AEROCRM_SEAT_CHANGE','ADMIN_SET_AEROCRM_SEATS')) = (fence_revision IS NOT NULL)
  );
