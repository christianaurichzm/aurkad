import { Request, Response, NextFunction } from 'express';
import { Access } from '../shared/types';

const checkAccess = (requiredAccess: Access) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const username = req.session.username;
    const accessLevel = req.session.accessLevel;

    if (!username || !accessLevel) {
      return res.status(401).send('Unauthorized');
    }

    if (accessLevel < requiredAccess) {
      return res.status(403).send('Forbidden');
    }

    next();
  };
};

export default checkAccess;
