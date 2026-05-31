import { UserModel } from '../models/user.model';

export interface UserApiResponseModel {
  data: UserModel[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SingleUserApiResponseModel {
  data: UserModel;
}
